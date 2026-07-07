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
import { DEV, emitDiagnostic } from "./dev.js";
import { NotReadyError } from "./error.js";
import { insertIntoHeap, runHeap, type Heap } from "./heap.js";
import {
  activeLanes,
  assignOrMergeLane,
  findLane,
  hasActiveOverride,
  signalLanes
} from "./lanes.js";
import {
  beginAsyncReporterWrites,
  createAsyncReporters,
  devCheckActiveOverrides,
  devCheckFlushStart,
  devCheckMergedLaneEmpty,
  devCheckQuiescent,
  endAsyncReporterWrites
} from "./invariants.js";
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
let halted = false;
let haltNotified = false;
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
    if (__DEV__) devCheckMergedLaneEmpty(lane);
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

function mergeTransitionState(target: Transition, outgoing: Transition): void {
  outgoing._done = target;
  target._actions.push(...outgoing._actions);
  for (const lane of activeLanes) if (lane._transition === outgoing) lane._transition = target;
  target._optimisticNodes.push(...outgoing._optimisticNodes);
  for (const store of outgoing._optimisticStores) target._optimisticStores.add(store);
  // Legal transfer, not a new registration: entries move between transitions.
  if (__DEV__) beginAsyncReporterWrites();
  for (const [source, reporters] of outgoing._asyncReporters) {
    let targetReporters = target._asyncReporters.get(source);
    if (!targetReporters) target._asyncReporters.set(source, (targetReporters = new Set()));
    for (const reporter of reporters) targetReporters.add(reporter);
  }
  if (__DEV__) endAsyncReporterWrites();
  for (const sub of outgoing._gatedSubs) target._gatedSubs.add(sub);
}

function resolveOptimisticNodes(nodes: OptimisticNode[]): void {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    node._optimisticLane = undefined;
    if (node._pendingValue !== NOT_PENDING) {
      node._value = node._pendingValue as any;
      node._pendingValue = NOT_PENDING;
      // Mirror commitPendingNode: the node now has a committed visible value.
      // Without this, a node first initialized under an optimistic override
      // (e.g. the latest() shadow computed during an initial-load transition)
      // stays UNINITIALIZED forever, so later pending phases mis-classify it
      // as an initial load and readers suspend instead of observing the
      // stale-value/pending pair (#2829).
      if (!((node as any)._statusFlags & STATUS_PENDING))
        (node as any)._statusFlags &= ~STATUS_UNINITIALIZED;
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

export function schedule() {
  if (halted) {
    notifyHalted();
    return;
  }
  if (scheduled) return;
  scheduled = true;
  if (!syncDepth && !globalQueue._running && !projectionWriteActive) queueMicrotask(flush);
}

/**
 * Permanently halts the reactive system. Called when a user error escapes
 * every boundary — app state is undefined at that point, so scheduling stops
 * entirely rather than limping along with a half-applied update.
 */
export function haltReactivity(): void {
  if (halted) return;
  halted = true;
  let message = "[REACTIVITY_HALTED] An uncaught error halted the reactive system.";
  if (__DEV__) {
    message +=
      " No further updates will be processed. Handle errors with createErrorBoundary/<Errored> or treat this as a crash.";
    emitDiagnostic({
      code: "REACTIVITY_HALTED",
      kind: "error",
      severity: "error",
      message
    });
  }
  console.error(message);
}

// Logs on the first write after a halt so a frozen interaction is traceable.
function notifyHalted(): void {
  if (haltNotified) return;
  haltNotified = true;
  console.error(
    __DEV__
      ? "[REACTIVITY_HALTED] Update ignored: the reactive system was halted by an earlier uncaught error."
      : "[REACTIVITY_HALTED] Update ignored."
  );
}

/** @internal Test/dev-reload hook. Revives scheduling after a halt. */
export function resetErrorHalt(): void {
  halted = false;
  haltNotified = false;
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
      runQueue(effects, type);
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
    try {
      if (__DEV__) devCheckFlushStart();
      runHeap(dirtyQueue, GlobalQueue._update);
      if (!activeTransition && transitions.size) {
        for (const transition of transitions) {
          if (transitionComplete(transition)) {
            activeTransition = transition;
            break;
          }
        }
      }
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
        this._pendingNodes !== activeTransition._pendingNodes &&
          this._pendingNodes.push(...activeTransition._pendingNodes);
        this.restoreQueues(activeTransition._queueStash);
        transitions.delete(activeTransition);
        const completingTransition = activeTransition;
        activeTransition = null;
        reassignPendingTransition(this._pendingNodes);
        finalizePureQueue(completingTransition);
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
      // Run lane effects first (for ready lanes), then regular effects
      activeLanes.size && runLaneEffects(EFFECT_RENDER);
      this.run(EFFECT_RENDER);
      activeLanes.size && runLaneEffects(EFFECT_USER);
      this.run(EFFECT_USER);
      if (__DEV__) {
        devCheckActiveOverrides(n => {
          if (this._optimisticNodes.includes(n as OptimisticNode)) return true;
          if (activeTransition?._optimisticNodes.includes(n as OptimisticNode)) return true;
          for (const t of transitions)
            if (t._optimisticNodes.includes(n as OptimisticNode)) return true;
          return false;
        });
      }
      if (
        __DEV__ &&
        !scheduled &&
        !activeTransition &&
        transitions.size === 0 &&
        activeLanes.size === 0
      ) {
        // Fully drained: no transition-scoped state may survive this point.
        devCheckQuiescent(n => n === this._pendingNode || this._pendingNodes.includes(n));
      }
      if (__DEV__) DEV.hooks.onUpdate?.();
    } finally {
      this._running = false;
    }
  }
  notify(node: Computed<any>, mask: number, flags: number, error?: any): boolean {
    // Only track async if the boundary is propagating STATUS_PENDING (not caught by boundary)
    if (mask & STATUS_PENDING) {
      if (flags & STATUS_PENDING) {
        const actualError = error !== undefined ? error : node._error;
        if (activeTransition && actualError) {
          const source = (actualError as NotReadyError).source;
          // The one sanctioned registration site (INV-3): async blockers only
          // enter the transition from queue notification.
          if (__DEV__) beginAsyncReporterWrites();
          let reporters = activeTransition._asyncReporters.get(source);
          if (!reporters) activeTransition._asyncReporters.set(source, (reporters = new Set()));
          if (__DEV__) endAsyncReporterWrites();
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
        _asyncReporters: __DEV__ ? createAsyncReporters() : new Map(),
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
  if (halted) return;
  let count = 0;
  // `flush()` is an explicit drain point, so it must also process an active
  // transition even if no microtask was scheduled for it yet.
  while (scheduled || activeTransition) {
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
    if (source._flags & REACTIVE_DISPOSED) {
      transition._asyncReporters.delete(source);
      continue;
    }
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
      if (hasActiveOverride(node) && node._deferRevert?.()) {
        done = false;
        break;
      }
      if (
        hasActiveOverride(node) &&
        "_statusFlags" in node &&
        node._statusFlags & STATUS_PENDING &&
        node._error instanceof NotReadyError
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
