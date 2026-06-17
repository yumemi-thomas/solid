import {
  CONFIG_IN_SNAPSHOT_SCOPE,
  CONFIG_OWNED_WRITE,
  EFFECT_RENDER,
  EFFECT_TRACKED,
  EFFECT_USER,
  NOT_PENDING,
  REACTIVE_DISPOSED,
  REACTIVE_MANUAL_WRITE,
  REACTIVE_OPTIMISTIC_DIRTY,
  REACTIVE_SNAPSHOT_STALE,
  REACTIVE_ZOMBIE,
  STATUS_PENDING,
  STATUS_UNINITIALIZED
} from "./constants.js";
import { currentOptimisticLane } from "./core.js";
import { DEV } from "./dev.js";
import { NotReadyError } from "./error.js";
import { insertIntoHeap, runHeap, type Heap } from "./heap.js";
import {
  activeLanes,
  assignOrMergeLane,
  findLane,
  hasActiveOverride,
  signalLanes
} from "./lanes.js";
import type { Computed, Signal } from "./types.js";

export { activeLanes, assignOrMergeLane, findLane };
export { getOrCreateLane, hasActiveOverride, mergeLanes, resolveLane } from "./lanes.js";

const transitions = new Set<Transition>();
export const dirtyQueue: Heap = {
  _heap: new Array(2000).fill(undefined),
  _marked: false,
  _min: 0,
  _max: 0
};
export const zombieQueue: Heap = {
  _heap: new Array(2000).fill(undefined),
  _marked: false,
  _min: 0,
  _max: 0
};

export let clock = 0;
export let activeTransition: Transition | null = null;
let scheduled = false;

/**
 * A renderer-installed hook that wraps the DOM-mutating render effects of a
 * committing transition. This is the seam that lets solid-web run a transition
 * commit inside `document.startViewTransition({ update })` without the rest of
 * userland calling `startViewTransition` manually — mirroring React, where the
 * DOM config owns the browser call and the reconciler just hands it a mutation
 * thunk.
 *
 * Contract: the wrapper MUST call `applyMutations()` (which runs the render
 * effects → DOM mutations). It may run it synchronously (no native support /
 * fallback) or asynchronously inside a view-transition update callback. When it
 * returns a thenable, the commit becomes async: layout/user effects and the
 * release of the scheduler's `_running` guard are deferred until it settles.
 *
 * Left `null` (the default), transition commits run fully synchronously exactly
 * as before — so this code tree-shakes out of sync-only bundles.
 */
export type TransitionCommitWrapper = (
  applyMutations: () => void,
  transition: Transition
) => void | PromiseLike<unknown>;
let commitWrapper: TransitionCommitWrapper | null = null;
export function setTransitionCommitWrapper(fn: TransitionCommitWrapper | null): void {
  commitWrapper = fn;
}

/**
 * Optional renderer-installed gate consulted right before a completed transition
 * commits. If it returns a thenable, the commit is deferred until that thenable
 * settles — leaving the transition active so writes meanwhile coalesce into it,
 * so the eventual commit reflects the latest state. solid-web returns the
 * in-flight browser view transition's `finished` promise, mirroring React's
 * `suspendOnActiveViewTransition`/`waitForCommitToBeReady`: the running animation
 * runs to completion and a new one fires toward the coalesced latest, instead of
 * a second `document.startViewTransition` aborting the first. The scheduler stays
 * renderer-agnostic — it knows nothing about view transitions, only "wait on this
 * thenable". Left `null` (the default), commits are never gated. Plain sync
 * updates never reach this branch, so they commit immediately (React parity: a
 * sync update cuts the animation).
 */
let commitGate: (() => PromiseLike<unknown> | null | undefined) | null = null;
export function setCommitGate(fn: (() => PromiseLike<unknown> | null | undefined) | null): void {
  commitGate = fn;
}

/**
 * Notifies a renderer when a transition is (re)initialized, so it can associate
 * out-of-band metadata with the transition object before it commits. solid-web
 * uses this to capture pending view-transition *types* — declared synchronously
 * via `addTransitionType` — onto the transition that will later commit
 * asynchronously, since the module-global type buffer is cleared on a microtask
 * that races ahead of an async commit. Called with the live `activeTransition`;
 * may fire multiple times for one transition (including across merges).
 */
let transitionInitHook: ((transition: Transition) => void) | null = null;
export function onTransitionInit(hook: ((transition: Transition) => void) | null): void {
  transitionInitHook = hook;
}
let syncDepth = 0;
export let projectionWriteActive = false;
let inTrackedQueueCallback = false;

let _enforceLoadingBoundary = false;
export let _hitUnhandledAsync = false;
// When a background transition is stashed, plain optimistic signals need one
// committed-view rerun. Keep that override local to the stash flush.
let stashedOptimisticReads: Set<Signal<any>> | null = null;

// Store property nodes that were created solely to carry a pending write (no
// subscribers at write time). Swept after each flush that commits pending
// values — any still without subs get disposed via their `_unobserved` hook,
// releasing the slot in the parent store's node map.
const transientStoreNodes = new Set<Signal<any>>();

export function registerTransientStoreNode(node: Signal<any>): void {
  transientStoreNodes.add(node);
}

function canUseSimpleSyncFlush(queue: GlobalQueue): boolean {
  return (
    transitions.size === 0 &&
    activeLanes.size === 0 &&
    queue._children.length === 0 &&
    queue._optimisticNodes.length === 0 &&
    queue._optimisticStores.size === 0 &&
    transientStoreNodes.size === 0
  );
}

function sweepTransientStoreNodes(): void {
  if (transientStoreNodes.size === 0) return;
  for (const node of transientStoreNodes) {
    if (node._subs !== null) {
      transientStoreNodes.delete(node);
      continue;
    }
    if (node._pendingValue !== NOT_PENDING) continue;
    if (node._overrideValue !== undefined && node._overrideValue !== NOT_PENDING) continue;
    transientStoreNodes.delete(node);
    node._unobserved?.();
  }
}
export function resetUnhandledAsync(): void {
  _hitUnhandledAsync = false;
}
/**
 * Toggles the dev-mode "must be inside a `<Loading>` boundary" enforcement
 * window. Only `render()` calls this — wrapping the initial mount so that a
 * top-level uncaught async read surfaces the diagnostic. Not part of the
 * user-facing API.
 *
 * @internal
 */
export function enforceLoadingBoundary(enabled: boolean): void {
  _enforceLoadingBoundary = enabled;
}

export function shouldReadStashedOptimisticValue(node: Signal<any>): boolean {
  return !!stashedOptimisticReads?.has(node);
}

/**
 * Run effects from all lanes that are ready (no pending async).
 */
function runLaneEffects(type: number): void {
  for (const lane of activeLanes) {
    if (lane._mergedInto || lane._pendingAsync.size > 0) continue;
    const effects = lane._effectQueues[type - 1];
    if (effects.length) {
      lane._effectQueues[type - 1] = [];
      runQueue(effects, type);
    }
  }
}

function queueStashedOptimisticEffects(node: Signal<any>): void {
  for (let s = node._subs; s !== null; s = s._nextSub) {
    const sub = s._sub as any;
    if (!sub._type) continue;
    if (sub._type === EFFECT_TRACKED) {
      if (!sub._modified) {
        sub._modified = true;
        sub._queue.enqueue(EFFECT_USER, sub._run);
      }
      continue;
    }
    const queue = sub._flags & REACTIVE_ZOMBIE ? zombieQueue : dirtyQueue;
    if (queue._min > sub._height) queue._min = sub._height;
    insertIntoHeap(sub, queue);
  }
}

export function setProjectionWriteActive(value: boolean) {
  projectionWriteActive = value;
}

export function setTrackedQueueCallback(value: boolean) {
  if (__DEV__) inTrackedQueueCallback = value;
}

export type QueueCallback = (type: number) => void;
type QueueStub = {
  _queues: [QueueCallback[], QueueCallback[]];
  _children: QueueStub[];
};
type OptimisticNode = Signal<any> | Computed<any>;
export interface Transition {
  _time: number;
  _asyncReporters: Map<Computed<any>, Set<Computed<any>>>;
  _pendingNodes: Signal<any>[];
  _optimisticNodes: OptimisticNode[]; // Optimistic signals/computeds pending transition reversion
  _optimisticStores: Set<any>;
  _actions: Array<Generator<any, any, any> | AsyncGenerator<any, any, any>>;
  _queueStash: QueueStub;
  _done: boolean | Transition;
  // Subscribers that, while recomputing under an optimistic lane, read a plain
  // signal's committed value through the entanglement gate. At commit they
  // get rescheduled so they re-run with the new committed view.
  _gatedSubs: Set<Computed<any>>;
}

type GestureRecord = {
  _value: unknown;
  _pendingValue: unknown;
  _overrideValue: unknown;
  _transition: Transition | null;
};

export interface GestureTransition {
  _records: Map<Signal<any> | Computed<any>, GestureRecord>;
  _active: boolean;
  _finished: boolean;
  // User effects deferred out of the gesture scrub: drained on commit, dropped
  // on cancel.
  _heldEffects: QueueCallback[];
}

export type GestureTransaction<T = unknown> = {
  _gesture: GestureTransition;
  result: T;
  commit(): void;
  cancel(): void;
};

export let activeGestureTransition: GestureTransition | null = null;

export function recordGestureWrite(node: Signal<any> | Computed<any>): void {
  const gesture = activeGestureTransition;
  if (!gesture || !gesture._active || gesture._records.has(node)) return;
  gesture._records.set(node, {
    _value: node._value,
    _pendingValue: node._pendingValue,
    _overrideValue: node._overrideValue,
    _transition: node._transition
  });
}

export function startGestureTransaction<T>(
  scope: () => T,
  previousTransaction?: GestureTransaction<unknown>
): GestureTransaction<T> {
  const gesture = previousTransaction?._gesture ?? {
    _records: new Map(),
    _active: true,
    _finished: false,
    _heldEffects: []
  };
  // Drain any already-pending work first, so the only user effects observed
  // during the gesture below are the ones the gesture itself causes.
  flush();
  const previousActiveGesture = activeGestureTransition;
  gesture._active = true;
  activeGestureTransition = gesture;
  let result!: T;
  try {
    result = scope();
    flush();
  } finally {
    gesture._active = false;
    activeGestureTransition = previousActiveGesture;
  }

  return {
    _gesture: gesture,
    result,
    commit() {
      if (gesture._finished) return;
      gesture._finished = true;
      gesture._records.clear();
      // The acted-on values are now permanent; run the held user effects once,
      // against the committed state, then drain any cascade.
      const held = gesture._heldEffects;
      if (held.length) {
        gesture._heldEffects = [];
        runQueue(held, EFFECT_USER);
        flush();
      }
    },
    cancel() {
      if (gesture._finished) return;
      gesture._finished = true;
      // The scope's user effects never ran; drop them.
      gesture._heldEffects = [];
      const records = [...gesture._records.entries()];
      gesture._records.clear();
      // Revert under an active gesture so the revert's render effects restore the
      // DOM while its user effects are held (then dropped) — a cancelled gesture
      // fires no user effects at all.
      const previousActiveGesture = activeGestureTransition;
      activeGestureTransition = gesture;
      gesture._active = true;
      try {
        for (let i = records.length - 1; i >= 0; i--) {
          const [node, record] = records[i];
          node._value = record._value as any;
          node._pendingValue = record._pendingValue as any;
          node._overrideValue = record._overrideValue as any;
          node._transition = record._transition;
          insertSubs(
            node,
            node._overrideValue !== undefined && node._overrideValue !== NOT_PENDING
          );
        }
        schedule();
        flush();
      } finally {
        gesture._active = false;
        activeGestureTransition = previousActiveGesture;
      }
      gesture._heldEffects = [];
    }
  };
}

function mergeTransitionState(target: Transition, outgoing: Transition): void {
  outgoing._done = target;
  target._actions.push(...outgoing._actions);
  for (const lane of activeLanes) if (lane._transition === outgoing) lane._transition = target;
  target._optimisticNodes.push(...outgoing._optimisticNodes);
  for (const store of outgoing._optimisticStores) target._optimisticStores.add(store);
  for (const [source, reporters] of outgoing._asyncReporters) {
    let targetReporters = target._asyncReporters.get(source);
    if (!targetReporters) target._asyncReporters.set(source, (targetReporters = new Set()));
    for (const reporter of reporters) targetReporters.add(reporter);
  }
  for (const sub of outgoing._gatedSubs) target._gatedSubs.add(sub);
}

function resolveOptimisticNodes(nodes: OptimisticNode[]): void {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    node._optimisticLane = undefined;
    if (node._pendingValue !== NOT_PENDING) {
      node._value = node._pendingValue as any;
      node._pendingValue = NOT_PENDING;
    }
    const prevOverride = node._overrideValue;
    node._overrideValue = NOT_PENDING;
    if (prevOverride !== NOT_PENDING && node._value !== prevOverride) insertSubs(node, true);
    node._transition = null;
  }
  nodes.length = 0;
}

function cleanupCompletedLanes(completingTransition: Transition | null): void {
  for (const lane of activeLanes) {
    const owned = completingTransition
      ? lane._transition === completingTransition
      : !lane._transition;
    if (!owned) continue;
    if (!lane._mergedInto) {
      if (lane._effectQueues[0].length) runQueue(lane._effectQueues[0], EFFECT_RENDER);
      if (lane._effectQueues[1].length) runQueue(lane._effectQueues[1], EFFECT_USER);
    }
    if (lane._source._optimisticLane === lane) lane._source._optimisticLane = undefined;
    lane._pendingAsync.clear();
    lane._effectQueues[0].length = 0;
    lane._effectQueues[1].length = 0;
    activeLanes.delete(lane);
    signalLanes.delete(lane._source);
  }
}

/**
 * True while the global queue is draining reactive work — i.e. during render-
 * and user-effect execution inside a flush. The web runtime's `<ViewTransition>`
 * update detection reads this synchronously to tell Solid-driven DOM writes
 * (which always happen during a flush) apart from asynchronous third-party
 * writes — browser extensions stamping `data-*`/`aria-*` attributes fire
 * outside any flush, so they are ignored. Being synchronous, there is no
 * observer-timing ambiguity.
 *
 * @internal
 */
export function isReactiveFlushActive(): boolean {
  return globalQueue._running;
}

export function schedule() {
  if (scheduled) return;
  scheduled = true;
  if (!syncDepth && !globalQueue._running && !projectionWriteActive) queueMicrotask(flush);
}

export interface IQueue {
  enqueue(type: number, fn: QueueCallback): void;
  run(type: number): boolean | void;
  addChild(child: IQueue): void;
  removeChild(child: IQueue): void;
  created: number;
  notify(node: Computed<any>, mask: number, flags: number, error?: any): boolean;
  stashQueues(stub: QueueStub): void;
  restoreQueues(stub: QueueStub): void;
  _parent: IQueue | null;
}

export class Queue implements IQueue {
  _parent: IQueue | null = null;
  _queues: [QueueCallback[], QueueCallback[]] = [[], []];
  _children: IQueue[] = [];
  created = clock;
  addChild(child: IQueue) {
    this._children.push(child);
    child._parent = this;
  }
  removeChild(child: IQueue) {
    const index = this._children.indexOf(child);
    if (index >= 0) {
      this._children.splice(index, 1);
      child._parent = null;
    }
  }
  notify(node: Computed<any>, mask: number, flags: number, error?: any): boolean {
    if (this._parent) return this._parent.notify(node, mask, flags, error);
    return false;
  }
  run(type: number) {
    if (this._queues[type - 1].length) {
      const effects = this._queues[type - 1];
      this._queues[type - 1] = [];
      // User effects are side-effects, so defer them out of a gesture scrub —
      // render effects still run, so the DOM updates for the snapshot. The gesture
      // drains pending work before it activates (see startGestureTransaction), so
      // every user effect seen here is caused by the gesture: hold it, then run on
      // commit / drop on cancel (like React), while the scope can still write.
      if (type === EFFECT_USER && activeGestureTransition?._active) {
        const held = activeGestureTransition._heldEffects;
        for (let i = 0; i < effects.length; i++) held.push(effects[i]);
      } else {
        runQueue(effects, type);
      }
    }
    for (let i = 0; i < this._children.length; i++) (this._children[i] as any).run?.(type);
  }
  enqueue(type: number, fn: QueueCallback): void {
    if (type) {
      // Route to lane's effect queue if we're in an optimistic recomputation
      if (currentOptimisticLane) {
        const lane = findLane(currentOptimisticLane);
        lane._effectQueues[type - 1].push(fn);
      } else {
        this._queues[type - 1].push(fn);
      }
    }
    schedule();
  }
  stashQueues(stub: QueueStub): void {
    stub._queues[0].push(...this._queues[0]);
    stub._queues[1].push(...this._queues[1]);
    this._queues = [[], []];
    for (let i = 0; i < this._children.length; i++) {
      let child = this._children[i];
      let childStub = stub._children[i];
      if (!childStub) {
        childStub = { _queues: [[], []], _children: [] };
        stub._children[i] = childStub;
      }
      child.stashQueues(childStub);
    }
  }
  restoreQueues(stub: QueueStub) {
    this._queues[0].push(...stub._queues[0]);
    this._queues[1].push(...stub._queues[1]);
    for (let i = 0; i < stub._children.length; i++) {
      const childStub = stub._children[i];
      let child = this._children[i];
      if (child) child.restoreQueues(childStub);
    }
  }
}

export class GlobalQueue extends Queue {
  _running: boolean = false;
  _pendingNode: Signal<any> | null = null;
  _pendingNodes: Signal<any>[] = [];
  _optimisticNodes: OptimisticNode[] = [];
  _optimisticStores: Set<any> = new Set();
  static _update: (el: Computed<unknown>) => void;
  static _dispose: (el: Computed<unknown>, self: boolean, zombie: boolean) => void;
  static _runEffect: (el: Computed<unknown>) => void;
  static _clearOptimisticStore: ((store: any) => void) | null = null;
  flush() {
    if (this._running) return;
    this._running = true;
    let committedTransition: Transition | null = null;
    let deferred = false;
    try {
      runHeap(dirtyQueue, GlobalQueue._update);
      if (activeTransition) {
        const isComplete = transitionComplete(activeTransition);
        if (!isComplete) {
          const stashedTransition = activeTransition!;
          runHeap(zombieQueue, GlobalQueue._update);
          this._pendingNode = null;
          this._pendingNodes = [];
          this._optimisticNodes = [];
          this._optimisticStores = new Set();

          // Run lane effects immediately (before stashing) - lanes with no pending async
          runLaneEffects(EFFECT_RENDER);
          runLaneEffects(EFFECT_USER);

          this.stashQueues(stashedTransition._queueStash);
          clock++;
          scheduled = dirtyQueue._max >= dirtyQueue._min;
          reassignPendingTransition(stashedTransition._pendingNodes);
          activeTransition = null;
          if (
            !stashedTransition._actions.length &&
            !stashedTransition._asyncReporters.size &&
            stashedTransition._optimisticNodes.length
          ) {
            stashedOptimisticReads = new Set();
            for (let i = 0; i < stashedTransition._optimisticNodes.length; i++) {
              const node = stashedTransition._optimisticNodes[i];
              if ((node as any)._fn || node._config & CONFIG_OWNED_WRITE) continue;
              stashedOptimisticReads.add(node);
              queueStashedOptimisticEffects(node);
            }
          }
          try {
            finalizePureQueue(null, true);
          } finally {
            stashedOptimisticReads = null;
          }
          return;
        }
        // Commit gate: if a renderer is still animating a previous commit (a
        // browser view transition), wait for it to finish before committing this
        // one — rather than committing now and aborting that animation. Holding
        // `_running` and leaving `activeTransition` + the queues untouched means
        // writes that arrive during the wait coalesce into this same transition,
        // so the deferred re-flush commits the latest state in one transition.
        // `transitionComplete` set a sticky `_done`, so the re-flush re-confirms
        // completeness for free and goes straight to commit. NOT the `!isComplete`
        // path above — that one is destructive (resets pending nodes, nulls the
        // transition). This path must change nothing but `deferred`.
        if (commitGate) {
          const wait = commitGate();
          if (wait != null && typeof (wait as PromiseLike<unknown>).then === "function") {
            deferred = true;
            const onClear = () => {
              this._running = false;
              // Re-flush on a microtask, not synchronously: the gate's thenable
              // is typically the same promise the renderer uses to clear its
              // "transition active" flag, so the hop guarantees that clear runs
              // before the re-evaluated gate (else it would defer forever).
              // Both arms resume — a rejected/aborted transition still means the
              // renderer is free, so the commit must proceed.
              queueMicrotask(flush);
            };
            (wait as PromiseLike<unknown>).then(onClear, onClear);
            return;
          }
        }
        this._pendingNodes !== activeTransition._pendingNodes &&
          this._pendingNodes.push(...activeTransition._pendingNodes);
        this.restoreQueues(activeTransition._queueStash);
        transitions.delete(activeTransition);
        committedTransition = activeTransition;
        activeTransition = null;
        reassignPendingTransition(this._pendingNodes);
        finalizePureQueue(committedTransition);
      } else {
        if (canUseSimpleSyncFlush(this)) {
          commitPendingNodes();
          if (dirtyQueue._max >= dirtyQueue._min) {
            runHeap(dirtyQueue, GlobalQueue._update);
            commitPendingNodes();
          }
        } else {
          if (transitions.size) runHeap(zombieQueue, GlobalQueue._update);
          finalizePureQueue();
        }
      }
      clock++;
      // Check if finalization added items to the heap (from optimistic reversion)
      scheduled = dirtyQueue._max >= dirtyQueue._min;
      // When a transition commits and a renderer installed a commit wrapper
      // (e.g. solid-web's document.startViewTransition bridge), hand the
      // DOM-mutating render effects to the wrapper so they run inside the
      // browser's view-transition update callback. The commit may then become
      // async; `commitWithWrapper` owns releasing `_running` via `settle()`.
      if (committedTransition && commitWrapper) {
        deferred = this.commitWithWrapper(committedTransition);
      } else {
        // Run lane effects first (for ready lanes), then regular effects
        activeLanes.size && runLaneEffects(EFFECT_RENDER);
        this.run(EFFECT_RENDER);
        activeLanes.size && runLaneEffects(EFFECT_USER);
        this.run(EFFECT_USER);
        if (__DEV__) DEV.hooks.onUpdate?.();
      }
    } finally {
      if (!deferred) this._running = false;
    }
  }
  /**
   * Run a committing transition's render effects through the installed
   * {@link TransitionCommitWrapper}. Render (DOM-mutating) effects are the
   * wrapper's `applyMutations` thunk; user/layout effects run afterwards.
   *
   * Returns `true` — the caller must NOT reset `_running` in its `finally`,
   * because `settle()` owns that, either synchronously (sync wrapper) or after
   * the wrapper's thenable resolves (async view transition). Holding `_running`
   * across the async gap serializes the commit: re-entrant `flush()` calls
   * early-return and writes made during the gap accumulate, then drain via the
   * microtask queued in `settle()`.
   */
  commitWithWrapper(transition: Transition): boolean {
    const runRender = () => {
      activeLanes.size && runLaneEffects(EFFECT_RENDER);
      this.run(EFFECT_RENDER);
    };
    const runUser = () => {
      activeLanes.size && runLaneEffects(EFFECT_USER);
      this.run(EFFECT_USER);
      if (__DEV__) DEV.hooks.onUpdate?.();
    };
    // Force `scheduled` false so the top-level flush() while-loop exits cleanly
    // instead of spinning on a guard-blocked re-entrant flush. Any genuinely
    // pending dirty work is remembered and re-drained once the commit settles.
    const resumeScheduled = scheduled;
    scheduled = false;
    const settle = () => {
      try {
        runUser();
      } finally {
        this._running = false;
        if (resumeScheduled) scheduled = true;
        if (scheduled || activeTransition) queueMicrotask(flush);
      }
    };
    let result: void | PromiseLike<unknown>;
    try {
      result = commitWrapper!(runRender, transition);
    } catch (err) {
      // The wrapper threw synchronously (e.g. a render effect threw inside a
      // no-native-support / mocked update). `settle()` never ran, so restore the
      // `scheduled` flag we cleared above and re-queue, or the genuinely-pending
      // work is stranded (the flush() loop early-returns while `_running` is held).
      this._running = false;
      if (resumeScheduled) scheduled = true;
      if (scheduled || activeTransition) queueMicrotask(flush);
      throw err;
    }
    if (result != null && typeof (result as PromiseLike<unknown>).then === "function") {
      (result as PromiseLike<unknown>).then(settle, settle);
    } else {
      settle();
    }
    return true;
  }
  notify(node: Computed<any>, mask: number, flags: number, error?: any): boolean {
    // Only track async if the boundary is propagating STATUS_PENDING (not caught by boundary)
    if (mask & STATUS_PENDING) {
      if (flags & STATUS_PENDING) {
        const actualError = error !== undefined ? error : node._error;
        if (activeTransition && actualError) {
          const source = (actualError as NotReadyError).source;
          let reporters = activeTransition._asyncReporters.get(source);
          if (!reporters) activeTransition._asyncReporters.set(source, (reporters = new Set()));
          const prevSize = reporters.size;
          reporters.add(node);
          if (reporters.size !== prevSize) schedule();
        }
        if (__DEV__ && _enforceLoadingBoundary) _hitUnhandledAsync = true;
      }
      return true;
    }
    return false;
  }
  initTransition(transition?: Transition | null): void {
    if (transition) transition = currentTransition(transition);
    if (transition && transition === activeTransition) return;
    if (!transition && activeTransition && activeTransition._time === clock) return;
    if (!activeTransition) {
      activeTransition = transition ?? {
        _time: clock,
        _pendingNodes: [],
        _asyncReporters: new Map(),
        _optimisticNodes: [],
        _optimisticStores: new Set(),
        _actions: [],
        _queueStash: { _queues: [[], []], _children: [] },
        _done: false,
        _gatedSubs: new Set()
      };
    } else if (transition) {
      const outgoing = activeTransition;
      mergeTransitionState(transition, outgoing);
      transitions.delete(outgoing);
      activeTransition = transition;
    }
    transitions.add(activeTransition);
    activeTransition._time = clock;
    if (this._pendingNode !== null) {
      this._pendingNode._transition = activeTransition;
      activeTransition._pendingNodes.push(this._pendingNode);
      this._pendingNode = null;
    }
    if (this._pendingNodes !== activeTransition._pendingNodes) {
      for (let i = 0; i < this._pendingNodes.length; i++) {
        const node = this._pendingNodes[i];
        node._transition = activeTransition;
        activeTransition._pendingNodes.push(node);
      }
      this._pendingNodes = activeTransition._pendingNodes;
    }
    if (this._optimisticNodes !== activeTransition._optimisticNodes) {
      for (let i = 0; i < this._optimisticNodes.length; i++) {
        const node = this._optimisticNodes[i];
        node._transition = activeTransition;
        activeTransition._optimisticNodes.push(node);
      }
      this._optimisticNodes = activeTransition._optimisticNodes;
    }
    for (const lane of activeLanes) {
      if (!lane._transition) lane._transition = activeTransition;
    }
    if (this._optimisticStores !== activeTransition._optimisticStores) {
      for (const store of this._optimisticStores) activeTransition._optimisticStores.add(store);
      this._optimisticStores = activeTransition._optimisticStores;
    }
    transitionInitHook?.(activeTransition);
  }
}

export function queuePendingNode(node: Signal<any>): void {
  if (activeTransition) {
    globalQueue._pendingNodes.push(node);
    return;
  }
  if (globalQueue._pendingNode === null && globalQueue._pendingNodes.length === 0) {
    globalQueue._pendingNode = node;
    return;
  }
  if (globalQueue._pendingNode !== null) {
    globalQueue._pendingNodes.push(globalQueue._pendingNode);
    globalQueue._pendingNode = null;
  }
  globalQueue._pendingNodes.push(node);
}

export function insertSubs(node: Signal<any> | Computed<any>, optimistic: boolean = false): void {
  // Get source lane: prefer node's own lane over current context
  // This is important for isPending signals which need their own lane to flush immediately
  const sourceLane = (node as any)._optimisticLane || currentOptimisticLane;

  const hasSnapshot = (node as any)._snapshotValue !== undefined;

  for (let s = node._subs; s !== null; s = s._nextSub) {
    if (hasSnapshot && s._sub._config & CONFIG_IN_SNAPSHOT_SCOPE) {
      s._sub._flags |= REACTIVE_SNAPSHOT_STALE;
      continue;
    }

    if (optimistic && sourceLane) {
      s._sub._flags |= REACTIVE_OPTIMISTIC_DIRTY;
      assignOrMergeLane(s._sub as any, sourceLane);
    } else if (optimistic) {
      s._sub._flags |= REACTIVE_OPTIMISTIC_DIRTY;
      // No source lane means reversion - clear subscriber's lane so effects go to regular queue
      (s._sub as any)._optimisticLane = undefined;
    }

    // Tracked effects bypass heap, go directly to effect queue
    const sub = s._sub as any;
    if (sub._type === EFFECT_TRACKED) {
      if (!sub._modified) {
        sub._modified = true;
        sub._queue.enqueue(EFFECT_USER, sub._run);
      }
      continue;
    }

    const queue = s._sub._flags & REACTIVE_ZOMBIE ? zombieQueue : dirtyQueue;
    if (queue._min > s._sub._height) queue._min = s._sub._height;
    insertIntoHeap(s._sub, queue);
  }
}

function commitPendingNode(n: Signal<any>): void {
  const c = n as Partial<Computed<unknown>>;
  if (!c._fn) {
    if (n._pendingValue !== NOT_PENDING) {
      n._value = n._pendingValue as any;
      n._pendingValue = NOT_PENDING;
    }
    return;
  }
  if (n._pendingValue !== NOT_PENDING) {
    n._value = n._pendingValue as any;
    n._pendingValue = NOT_PENDING;
    // Set _modified for effects, but not for tracked effects (they handle their own scheduling)
    if ((n as any)._type && (n as any)._type !== EFFECT_TRACKED) (n as any)._modified = true;
  }
  c._flags! &= ~REACTIVE_MANUAL_WRITE;
  if (!(c._statusFlags! & STATUS_PENDING)) c._statusFlags! &= ~STATUS_UNINITIALIZED;
  if (c._pendingFirstChild !== null || c._pendingDisposal !== null)
    GlobalQueue._dispose(c as Computed<unknown>, false, true);
}

function commitPendingNodes() {
  if (globalQueue._pendingNode !== null) {
    commitPendingNode(globalQueue._pendingNode);
    globalQueue._pendingNode = null;
  }
  const pendingNodes = globalQueue._pendingNodes;
  for (let i = 0; i < pendingNodes.length; i++) {
    commitPendingNode(pendingNodes[i]);
  }
  pendingNodes.length = 0;
}

export function finalizePureQueue(
  completingTransition: Transition | null = null,
  incomplete: boolean = false
) {
  // For incomplete transitions, skip pending resolution and optimistic reversion
  // For completing transitions or no-transition, resolve pending and revert optimistic
  const resolvePending = !incomplete;
  if (resolvePending) commitPendingNodes();
  if (!incomplete && globalQueue._children.length) checkBoundaryChildren(globalQueue);
  const ranHeap = dirtyQueue._max >= dirtyQueue._min;
  if (ranHeap) runHeap(dirtyQueue, GlobalQueue._update);
  if (resolvePending) {
    if (ranHeap) commitPendingNodes();
    resolveOptimisticNodes(
      completingTransition ? completingTransition._optimisticNodes : globalQueue._optimisticNodes
    );
    // Replay entanglement: subs recorded by the read-time gate get rescheduled
    // so they re-run with the now-committed values visible.
    if (completingTransition && completingTransition._gatedSubs.size) {
      for (const sub of completingTransition._gatedSubs) {
        if (sub._flags & REACTIVE_DISPOSED) continue;
        if ((sub as any)._type === EFFECT_TRACKED) {
          if (!(sub as any)._modified) {
            (sub as any)._modified = true;
            sub._queue.enqueue(EFFECT_USER, (sub as any)._run);
          }
          continue;
        }
        const queue = sub._flags & REACTIVE_ZOMBIE ? zombieQueue : dirtyQueue;
        if (queue._min > sub._height) queue._min = sub._height;
        insertIntoHeap(sub, queue);
      }
      completingTransition._gatedSubs.clear();
    }
    const optimisticStores = completingTransition
      ? completingTransition._optimisticStores
      : globalQueue._optimisticStores;
    if (GlobalQueue._clearOptimisticStore && optimisticStores.size) {
      for (const store of optimisticStores) {
        GlobalQueue._clearOptimisticStore(store);
      }
      optimisticStores.clear();
      schedule();
    }
    sweepTransientStoreNodes();
    cleanupCompletedLanes(completingTransition);
  }
}

function checkBoundaryChildren(queue: Queue) {
  for (const child of queue._children) {
    (child as any).checkSources?.();
    checkBoundaryChildren(child as Queue);
  }
}

export function trackOptimisticStore(store: any): void {
  // After initTransition, globalQueue._optimisticStores IS activeTransition._optimisticStores (same reference)
  globalQueue._optimisticStores.add(store);
  schedule();
}

function reassignPendingTransition(pendingNodes: Signal<any>[]) {
  for (let i = 0; i < pendingNodes.length; i++) {
    pendingNodes[i]._transition = activeTransition;
  }
}

export const globalQueue = new GlobalQueue();

/**
 * Synchronously processes the pending reactive queue, or runs `fn` in a synchronous
 * flush scope before draining the queue.
 *
 * Reactive updates are normally batched onto the microtask queue, so multiple
 * writes in a row collapse into a single update pass. Call `flush()` when you
 * need to *observe* the result of those writes synchronously — most commonly
 * in tests, but also at the boundary of imperative integration code. Pass a
 * callback when the writes themselves should bypass microtask scheduling and
 * drain synchronously when the callback returns.
 *
 * @example
 * ```ts
 * const [count, setCount] = createSignal(0);
 * const doubled = createMemo(() => count() * 2);
 *
 * setCount(5);
 * flush();
 * expect(doubled()).toBe(10);
 *
 * flush(() => setCount(6));
 * expect(doubled()).toBe(12);
 *
 * // Nested flushes drain at each level:
 * flush(() => {
 *   setCount(7);
 *   flush(() => setCount(8)); // inner drain — effects fire here
 *   // outer continues with up-to-date state
 * });
 * ```
 */
export function flush(): void;
export function flush<T>(fn: () => T): T;
export function flush<T>(fn?: () => T): T | void {
  if (fn) {
    syncDepth++;
    try {
      return fn();
    } finally {
      // Decrement even if the drain throws (a throwing effect): a leaked
      // syncDepth would stop `schedule()` from ever queuing a microtask again.
      try {
        flush();
      } finally {
        syncDepth--;
      }
    }
  }
  if (globalQueue._running) {
    if (__DEV__ && inTrackedQueueCallback) {
      throw new Error(
        "Cannot call flush() from inside onSettled or createTrackedEffect. flush() is not reentrant there."
      );
    }
    return;
  }
  let count = 0;
  // `flush()` is an explicit drain point, so it must also process an active
  // transition even if no microtask was scheduled for it yet.
  while (scheduled || activeTransition) {
    // A deferred transition commit (the view-transition seam) holds the queue
    // with `_running` across its async gap; `globalQueue.flush()` would just
    // early-return, so spinning here is pointless. Yield — the commit's `settle()`
    // re-drains via a microtask once the mutation lands. (Without this, a
    // transition that reveals freshly-mounted async content loops forever, since
    // the mount re-schedules work while the commit still holds the queue.)
    if (globalQueue._running) break;
    if (__DEV__ && ++count === 1e5) throw new Error("Potential Infinite Loop Detected.");
    globalQueue.flush();
  }
}

function runQueue(queue: QueueCallback[], type: number): void {
  for (let i = 0; i < queue.length; i++) queue[i](type);
}

function reporterBlocksSource(reporter: Computed<any>, source: Computed<any>): boolean {
  if (reporter._flags & (REACTIVE_ZOMBIE | REACTIVE_DISPOSED)) return false;
  if (reporter._pendingSource === source || reporter._pendingSources?.has(source)) return true;
  for (let dep = reporter._deps; dep; dep = dep._nextDep) {
    let current = dep._dep as Signal<any> | Computed<any> | undefined;
    while (current) {
      if (current === source || (current as any)._firewall === source) return true;
      current = current._parentSource;
    }
  }
  return !!(
    reporter._statusFlags & STATUS_PENDING &&
    reporter._error instanceof NotReadyError &&
    reporter._error.source === source
  );
}

function transitionComplete(transition: Transition): boolean {
  if (transition._done) return true;
  if (transition._actions.length) return false;
  let done = true;
  for (const [source, reporters] of transition._asyncReporters) {
    let hasLive = false;
    for (const reporter of reporters) {
      if (reporterBlocksSource(reporter, source)) {
        hasLive = true;
        break;
      }
      reporters.delete(reporter);
    }
    if (!hasLive) transition._asyncReporters.delete(source);
    else if (
      source._statusFlags & STATUS_PENDING &&
      (source._error as NotReadyError)?.source === source
    ) {
      done = false;
      break;
    }
  }
  if (done) {
    for (let i = 0; i < transition._optimisticNodes.length; i++) {
      const node = transition._optimisticNodes[i];
      if (
        hasActiveOverride(node) &&
        "_statusFlags" in node &&
        node._statusFlags & STATUS_PENDING &&
        node._error instanceof NotReadyError &&
        node._error.source !== node
      ) {
        done = false;
        break;
      }
    }
  }
  done && (transition._done = true);
  return done;
}
export function currentTransition(transition: Transition) {
  while (transition._done && typeof transition._done === "object") transition = transition._done;
  return transition;
}

export function setActiveTransition(transition: Transition | null) {
  activeTransition = transition;
}

export function runInTransition<T>(transition: Transition, fn: () => T): T {
  const prevTransition = activeTransition;

  try {
    activeTransition = currentTransition(transition);
    return fn();
  } finally {
    activeTransition = prevTransition;
  }
}

// DEV diagnostic for the async-scope footgun. Counts in-flight async
// `startTransition` scopes; while any are pending, a write that lands outside a
// transition (and outside a flush) is almost certainly a post-`await` write in
// the scope — which is NOT part of the transition. Warn once per pending window.
let pendingAsyncTransitions = 0;
let warnedPostAwaitWrite = false;

/** @internal DEV-only. Called from `setSignal`. */
export function checkPostAwaitTransitionWrite(): void {
  if (
    pendingAsyncTransitions > 0 &&
    !warnedPostAwaitWrite &&
    activeTransition === null &&
    !globalQueue._running &&
    !syncDepth
  ) {
    warnedPostAwaitWrite = true;
    console.warn(
      "[solid] A signal was written while an async startTransition was pending, but " +
        "outside the transition. Writes after an `await` inside a startTransition scope " +
        "are not part of the transition — they won't be batched or animated with it. " +
        "Make those writes synchronously before the first `await`, or use `action` for " +
        "multi-step async transactions."
    );
  }
}

/**
 * Runs `fn` as a transition: every write inside it is deferred and committed
 * together, and the commit is handed to the view-transition seam — so if it
 * lands under a `<ViewTransition>` it animates automatically. This is how a
 * change opts into an animated/batched commit; the async-native paths
 * (`createAsync`, actions, optimistic) already form transitions on their own.
 *
 * - **Synchronous scope** (`fn` returns a non-thenable): the transition
 *   completes and commits within this call; returns `fn`'s value.
 * - **Async scope** (`fn` returns a thenable): the transition is held open
 *   until the scope settles AND any reactive async it triggered resolves, then
 *   commits as one. Returns a promise for `fn`'s result. Writes made *before*
 *   the first `await` are part of the transition; writes made *after* an `await`
 *   are not (a plain async continuation can't carry the transition context — use
 *   synchronous writes, or `action` for multi-step async transactions).
 *
 * Mirrors React's `startTransition`: write through it instead of calling
 * `startViewTransition` by hand.
 */
export function startTransition<T>(fn: () => Promise<T>): Promise<T>;
export function startTransition<T>(fn: () => T): T;
export function startTransition<T>(fn: () => T | Promise<T>): T | Promise<T> {
  globalQueue.initTransition();
  const ctx = activeTransition!;
  let result: T | Promise<T>;
  try {
    result = fn();
  } catch (error) {
    flush();
    throw error;
  }
  // `fn` may have declared view-transition types (addTransitionType) now that the
  // transition exists. Re-notify the init hook so a renderer can capture them
  // onto the transition before it commits — the hook fired at initTransition,
  // before `fn` ran, so it would otherwise miss types declared inside the scope.
  if (activeTransition) transitionInitHook?.(activeTransition);
  if (!result || typeof (result as Promise<T>).then !== "function") {
    flush();
    return result;
  }
  // Async scope: a marker in `_actions` keeps `transitionComplete` false so the
  // commit waits for the scope to settle (the scheduler may still partially run
  // ready lanes meanwhile, but pending writes stay uncommitted). On settle we
  // re-establish the transition and flush, committing once everything is ready.
  const marker = {} as unknown as Generator<any>;
  ctx._actions.push(marker);
  if (__DEV__ && pendingAsyncTransitions++ === 0) warnedPostAwaitWrite = false;
  const settle = () => {
    if (__DEV__) pendingAsyncTransitions--;
    const live = currentTransition(ctx);
    globalQueue.initTransition(live);
    const i = live._actions.indexOf(marker);
    if (i >= 0) live._actions.splice(i, 1);
    flush();
  };
  return (result as Promise<T>).then(
    value => {
      settle();
      return value;
    },
    error => {
      settle();
      throw error;
    }
  );
}
