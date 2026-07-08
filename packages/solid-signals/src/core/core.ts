import { clearStatus, handleAsync, notifyStatus } from "./async.js";
import {
  $REFRESH,
  CONFIG_AUTO_DISPOSE,
  CONFIG_CHILDREN_FORBIDDEN,
  CONFIG_IN_SNAPSHOT_SCOPE,
  CONFIG_NO_SNAPSHOT,
  CONFIG_OWNED_WRITE,
  CONFIG_SYNC,
  CONFIG_TRANSPARENT,
  defaultContext,
  EFFECT_TRACKED,
  EFFECT_USER,
  NO_SNAPSHOT,
  NOT_PENDING,
  REACTIVE_CHECK,
  REACTIVE_DIRTY,
  REACTIVE_DISPOSED,
  REACTIVE_IN_HEAP,
  REACTIVE_IN_HEAP_HEIGHT,
  REACTIVE_LAZY,
  REACTIVE_MANUAL_WRITE,
  REACTIVE_NONE,
  REACTIVE_OPTIMISTIC_DIRTY,
  REACTIVE_RECOMPUTING_DEPS,
  REACTIVE_SNAPSHOT_STALE,
  REACTIVE_ZOMBIE,
  STATUS_ERROR,
  STATUS_PENDING,
  STATUS_UNINITIALIZED,
  STORE_SNAPSHOT_PROPS,
  type Refreshable
} from "./constants.js";
import { NotReadyError } from "./error.js";
import { externalSourceConfig } from "./external.js";
import { link, trimStaleDeps, unobserved } from "./graph.js";
import {
  deleteFromHeap,
  insertIntoHeap,
  insertIntoHeapHeight,
  markHeap,
  markNode
} from "./heap.js";
import {
  findLane,
  getOrCreateLane,
  hasActiveOverride,
  resolveLane,
  resolveTransition,
  type OptimisticLane
} from "./lanes.js";
import { clearSignals, DEV, emitDiagnostic } from "./dev.js";
import {
  devTrackCompanionOwner,
  devTrackHeldPending,
  devTrackOptimistic,
  InvariantHooks
} from "./invariants.js";
import { cleanup, disposeChildren, getNextChildId, markDisposal } from "./owner.js";
import {
  activeTransition,
  assignOrMergeLane,
  clock,
  dirtyQueue,
  globalQueue,
  GlobalQueue,
  insertSubs,
  projectionWriteActive,
  queuePendingNode,
  runInTransition,
  schedule,
  shouldReadStashedOptimisticValue,
  zombieQueue
} from "./scheduler.js";
import type { Computed, FirewallSignal, Link, NodeOptions, Owner, Root, Signal } from "./types.js";

GlobalQueue._update = recompute;
GlobalQueue._dispose = disposeChildren;

export const PRIMITIVE_IN_FORBIDDEN_SCOPE_MESSAGE =
  "[PRIMITIVE_IN_FORBIDDEN_SCOPE] Cannot create reactive primitives inside createTrackedEffect or owner-backed onSettled";
export const REACTIVE_WRITE_IN_OWNED_SCOPE_SIGNAL_MESSAGE =
  "[REACTIVE_WRITE_IN_OWNED_SCOPE] Writing to reactive state inside an owned scope (component, computation) is not allowed. " +
  "Move the write outside or set the `ownedWrite` option if this is intentional.";
export const REACTIVE_WRITE_IN_OWNED_SCOPE_REFRESH_MESSAGE =
  "[REACTIVE_WRITE_IN_OWNED_SCOPE] Calling refresh() inside an owned scope (component, computation) is not allowed. " +
  "Move the invalidation outside pure computation.";

export let tracking = false;
export let stale = false;
export let pendingCheckActive = false;
export let latestReadActive = false;
export let context: Owner | null = null;
export let currentOptimisticLane: OptimisticLane | null = null;

/**
 * Per-probe state for an active isPending() call. `pendingCheckActive` stays a
 * separate boolean because it doubles as the hot-path "intercept reads" toggle
 * (flipped off during nested reads); the probe object holds everything scoped
 * to one isPending() invocation. Invariant: `pendingCheckActive === true`
 * implies `pendingProbe !== null`.
 */
interface PendingProbe {
  found: boolean;
  sources: Set<Signal<any> | Computed<any>>;
  // Sources whose value this probe observed as the fresh transition-held
  // `_pendingValue` (not the stale committed value) — see the pair-consistency
  // rule in `isPending` (#2831).
  freshReads: Set<Signal<any> | Computed<any>>;
}
let pendingProbe: PendingProbe | null = null;

if (__DEV__) {
  InvariantHooks.pendingProbeActive = () => pendingProbe !== null;
  InvariantHooks.computePendingState = computePendingState;
}

export let snapshotCaptureActive = false;
export let snapshotSources: Set<any> | null = null;

function ownerInSnapshotScope(owner: Owner | null): boolean {
  while (owner) {
    if (owner._snapshotScope) return true;
    owner = owner._parent;
  }
  return false;
}

export function setSnapshotCapture(active: boolean): void {
  snapshotCaptureActive = active;
  if (active && !snapshotSources) snapshotSources = new Set();
}

export function markSnapshotScope(owner: Owner): void {
  owner._snapshotScope = true;
}

export function releaseSnapshotScope(owner: Owner): void {
  owner._snapshotScope = false;
  releaseSubtree(owner);
  schedule();
}

function releaseSubtree(owner: Owner): void {
  let child = owner._firstChild;
  while (child) {
    if (child._snapshotScope) {
      child = child._nextSibling;
      continue;
    }
    if ((child as any)._fn) {
      const comp = child as Computed<any>;
      comp._config &= ~CONFIG_IN_SNAPSHOT_SCOPE;
      if (comp._flags & REACTIVE_SNAPSHOT_STALE) {
        comp._flags &= ~REACTIVE_SNAPSHOT_STALE;
        comp._flags |= REACTIVE_DIRTY;
        if (dirtyQueue._min > comp._height) dirtyQueue._min = comp._height;
        insertIntoHeap(comp, dirtyQueue);
      }
    }
    releaseSubtree(child);
    child = child._nextSibling;
  }
}

export function clearSnapshots(): void {
  if (snapshotSources) {
    for (const source of snapshotSources) {
      delete source._snapshotValue;
      delete source[STORE_SNAPSHOT_PROPS];
    }
    snapshotSources = null;
  }
  snapshotCaptureActive = false;
}

export function recompute(el: Computed<any>, create: boolean = false): void {
  const isEffect = (el as any)._type;
  if (!create) {
    if (el._transition && (!isEffect || activeTransition) && activeTransition !== el._transition)
      globalQueue.initTransition(el._transition);
    deleteFromHeap(el, el._flags & REACTIVE_ZOMBIE ? zombieQueue : dirtyQueue);
    el._inFlight = null;
    // Tracked effects run after finalizePureQueue, so dispose immediately instead of deferring
    if (el._transition || isEffect === EFFECT_TRACKED) disposeChildren(el);
    else if (el._firstChild !== null || el._disposal !== null) {
      markDisposal(el);
      el._pendingDisposal = el._disposal;
      el._pendingFirstChild = el._firstChild;
      el._disposal = null;
      el._firstChild = null;
      el._childCount = 0;
      if (__DEV__) clearSignals(el);
    } else if (__DEV__) clearSignals(el);
  }

  let isOptimisticDirty = !!(el._flags & REACTIVE_OPTIMISTIC_DIRTY);
  const hasOverride = el._overrideValue !== undefined && el._overrideValue !== NOT_PENDING;
  // Track if node was pending (for detecting async resolution)
  const wasPending = !!(el._statusFlags & STATUS_PENDING);
  const wasUninitialized = !!(el._statusFlags & STATUS_UNINITIALIZED);

  const oldcontext = context;
  context = el;
  el._depsTail = null;
  el._depGen++;
  el._flags = REACTIVE_RECOMPUTING_DEPS;
  el._time = clock;
  let value = el._pendingValue === NOT_PENDING ? el._value : el._pendingValue;
  let oldHeight = el._height;
  let prevTracking = tracking;
  let prevLane = currentOptimisticLane;
  let prevStrictRead: string | false = false;
  if (__DEV__) {
    prevStrictRead = strictRead;
    strictRead = false;
  }
  tracking = true;
  if (isOptimisticDirty) {
    const lane = resolveLane(el);
    if (lane) currentOptimisticLane = lane;
  } else if (activeTransition && !create && activeTransition._optimisticNodes.length) {
    // Lane adoption: parent-deeper-than-owned-child can run before its OPT-dirty
    // child propagates. Walk deps once and inherit the OPT lane so this node
    // recomputes under the right posture and propagates correctly.
    for (let d: Link | null = el._deps; d; d = d._nextDep) {
      const dep = d._dep as Computed<any>;
      if (dep._flags & REACTIVE_OPTIMISTIC_DIRTY) {
        const depLane = resolveLane(dep);
        if (depLane) {
          isOptimisticDirty = true;
          currentOptimisticLane = depLane;
          el._flags |= REACTIVE_OPTIMISTIC_DIRTY;
          assignOrMergeLane(el as any, depLane);
          break;
        }
      }
    }
  }
  const isStaleEffect = isEffect && isEffect !== EFFECT_USER;
  const prevStale = stale;
  if (isStaleEffect) stale = true;
  try {
    if (!__DEV__ && el._config & CONFIG_SYNC) {
      value = el._fn(value);
      el._inFlight = null;
    } else {
      // Snapshot `_inFlight` so we can detect whether `_fn` self-registered an async
      // subscription (e.g. `createProjection` calls `handleAsync` from inside its body
      // with a setter callback). In that case, the outer `handleAsync` call below would
      // clobber the fresh subscription, so we skip it and let the internally-registered
      // iteration drive updates.
      const prevInFlight = el._inFlight;
      const fnResult = el._fn(value);
      const isAsyncResult = typeof fnResult === "object" && fnResult !== null;
      const inFlightChanged = el._inFlight !== prevInFlight;
      value = inFlightChanged || !isAsyncResult ? fnResult : handleAsync(el, fnResult);
      if (!inFlightChanged && !isAsyncResult) el._inFlight = null;
    }
    clearStatus(el, create);
    if (el._optimisticLane) {
      const resolvedLane = resolveLane(el);
      if (resolvedLane) {
        resolvedLane._pendingAsync.delete(el);
        updatePendingSignal(resolvedLane._source);
      }
    }
  } catch (e) {
    // Track pending async in the lane (not the lane's source — it creates the lane
    // but doesn't belong to it). Set lane BEFORE notifyStatus for downstream propagation.
    if (e instanceof NotReadyError && currentOptimisticLane) {
      const lane = findLane(currentOptimisticLane);
      if (lane._source !== el) {
        lane._pendingAsync.add(el);
        el._optimisticLane = lane;
        updatePendingSignal(lane._source);
      }
    }
    if (e instanceof NotReadyError) el._blocked = true;
    notifyStatus(
      el,
      e instanceof NotReadyError ? STATUS_PENDING : STATUS_ERROR,
      e,
      undefined,
      e instanceof NotReadyError ? el._optimisticLane : undefined
    );
  } finally {
    tracking = prevTracking;
    if (__DEV__) strictRead = prevStrictRead;
    if (isStaleEffect) stale = prevStale;
    el._flags = REACTIVE_NONE | (create ? el._flags & REACTIVE_SNAPSHOT_STALE : 0);
    context = oldcontext;
  }

  if (!el._error) {
    trimStaleDeps(el);
    const compareValue = hasOverride
      ? el._overrideValue
      : el._pendingValue === NOT_PENDING
        ? el._value
        : el._pendingValue;
    let valueChanged = false;
    try {
      valueChanged =
        (!isEffect && wasUninitialized) || !el._equals || !el._equals(compareValue, value);
    } catch (e) {
      // A throwing user comparator is an error of this node's computation.
      // Route it through the same status path as a compute-phase throw so
      // error boundaries contain it; otherwise it unwinds the scheduler
      // flush, bypassing every boundary and wedging the queue (#2837).
      notifyStatus(el, STATUS_ERROR, e);
    }

    // Effects use `_equals: false` (no per-effect closure). The side effects that
    // the equals closure used to perform — flagging the effect dirty and enqueueing
    // its runner — happen here instead. `!create` matches the previous `initialized`
    // gate: the explicit recompute(node, true) inside effect() does not enqueue, so
    // effect() can call its runner synchronously for the first run.
    if (isEffect && valueChanged) {
      (el as any)._modified = !el._error;
      // Reuse one bound runner per effect — runEffect no-ops on a stale
      // `_modified`, so re-enqueueing the same function is harmless.
      if (!create)
        el._queue.enqueue(
          isEffect,
          ((el as any)._boundRunEffect ??= GlobalQueue._runEffect.bind(null, el))
        );
    }

    if (el._error) {
      // Comparator threw: skip the commit — the node is now errored and the
      // status propagation above owns downstream notification.
    } else if (valueChanged) {
      const prevVisible = hasOverride ? el._overrideValue : undefined;

      if (create || (isEffect && activeTransition !== el._transition) || isOptimisticDirty) {
        el._value = value;
        // Lane-propagated correction: upstream data is fresh, correct the
        // override unconditionally. The direct _value commit is the lane's
        // own reveal schedule; drop any superseded older hold so its queued
        // commit can't clobber the fresh value.
        if (hasOverride && isOptimisticDirty) {
          el._overrideValue = value;
          el._pendingValue = NOT_PENDING;
        }
      } else {
        el._pendingValue = value;
        if (__DEV__) devTrackHeldPending(el);
        // Transition-held sync recompute is a write path like setSignal/asyncWrite,
        // so sync derivations of held sources stay visible to isPending()/latest()
        // (#2831). Both companion writes are transition-scoped (optimistic) and
        // auto-revert/re-derive at commit. Skipped for plain flushes where the
        // pending value commits before effects run.
        if (activeTransition || el._transition) syncCompanions(el, value);
      }

      if (!hasOverride || isOptimisticDirty || el._overrideValue !== prevVisible)
        insertSubs(el, isOptimisticDirty || hasOverride);
    } else if (hasOverride) {
      // Unchanged value (equals the override) recomputed while the override
      // is active: _value may still be stale, so hold the authoritative value
      // for commit on its own transition's schedule — invisibly (A17/A18).
      if (el._pendingValue === NOT_PENDING) queuePendingNode(el);
      el._pendingValue = value;
      if (__DEV__) devTrackHeldPending(el);
    } else if (el._height != oldHeight) {
      for (let s = el._subs; s !== null; s = s._nextSub) {
        insertIntoHeapHeight(s._sub, s._sub._flags & REACTIVE_ZOMBIE ? zombieQueue : dirtyQueue);
      }
    }
  }
  currentOptimisticLane = prevLane;
  const needsPendingCommit =
    el._pendingValue !== NOT_PENDING ||
    el._pendingFirstChild !== null ||
    el._pendingDisposal !== null ||
    !!(el._statusFlags & (STATUS_PENDING | STATUS_UNINITIALIZED));
  // Masked holds (hasOverride) always queue: their commit belongs to their
  // own transition's schedule (A18 re-rule) and is unobservable under the
  // override (A17). Revert no longer commits anything, so an unqueued masked
  // hold would leak (INV-7) once the revert clears _transition.
  needsPendingCommit &&
    (!create || el._statusFlags & STATUS_PENDING) &&
    (!el._transition || hasOverride) &&
    queuePendingNode(el);
  el._transition &&
    isEffect &&
    activeTransition !== el._transition &&
    runInTransition(el._transition, () => recompute(el));
}

function updateIfNecessary(el: Computed<unknown>): void {
  if (el._flags & REACTIVE_CHECK) {
    for (let d = el._deps; d; d = d._nextDep) {
      const dep1 = d._dep;
      const dep = (dep1 as FirewallSignal<unknown>)._firewall || dep1;
      if ((dep as Computed<unknown>)._fn) {
        updateIfNecessary(dep);
      }
      if (el._flags & REACTIVE_DIRTY) {
        break;
      }
    }
  }

  if (
    el._flags & (REACTIVE_DIRTY | REACTIVE_OPTIMISTIC_DIRTY) ||
    (el._error && el._time < clock && !el._inFlight)
  ) {
    recompute(el);
  }

  el._flags = el._flags & (REACTIVE_SNAPSHOT_STALE | REACTIVE_IN_HEAP | REACTIVE_IN_HEAP_HEIGHT);
}

export function computed<T>(fn: (prev?: T) => T | PromiseLike<T> | AsyncIterable<T>): Computed<T>;
export function computed<T>(
  fn: (prev: T) => T | PromiseLike<T> | AsyncIterable<T>,
  options?: NodeOptions<T>
): Computed<T>;
export function computed<T>(
  fn: (prev?: T) => T | PromiseLike<T> | AsyncIterable<T>,
  options?: NodeOptions<T>
): Computed<T> {
  const transparent = options?.transparent ?? false;
  const self: Computed<T> = {
    id:
      options?.id ??
      (transparent ? context?.id : context?.id != null ? getNextChildId(context) : undefined),
    _config:
      (transparent ? CONFIG_TRANSPARENT : 0) |
      (options?.ownedWrite ? CONFIG_OWNED_WRITE : 0) |
      (!context || options?.lazy ? CONFIG_AUTO_DISPOSE : 0) |
      (options?.sync ? CONFIG_SYNC : 0) |
      (options?._noSnapshot ? CONFIG_NO_SNAPSHOT : 0) |
      (snapshotCaptureActive && ownerInSnapshotScope(context) ? CONFIG_IN_SNAPSHOT_SCOPE : 0),
    _equals: options?.equals != null ? options.equals : isEqual,
    _unobserved: options?.unobserved,
    _disposal: null,
    _queue: context?._queue ?? globalQueue,
    _context: context?._context ?? defaultContext,
    _childCount: 0,
    _fn: fn,
    _value: undefined as T,
    _height: 0,
    _child: null,
    _nextHeap: undefined,
    _prevHeap: null as any,
    _deps: null,
    _depsTail: null,
    _depGen: 0,
    _subs: null,
    _subsTail: null,
    _parent: context,
    _nextSibling: null,
    _prevSibling: null,
    _firstChild: null,
    _flags: options?.lazy ? REACTIVE_LAZY : REACTIVE_NONE,
    _statusFlags: STATUS_UNINITIALIZED,
    _time: clock,
    _pendingValue: NOT_PENDING,
    _pendingDisposal: null,
    _pendingFirstChild: null,
    _inFlight: null,
    _transition: null
  } as Computed<T>;
  if (__DEV__) (self as any)._name = options?.name ?? "computed";
  setupComputedNode(self, options);
  return self;
}

/**
 * Build an Effect node with all effect-specific fields baked into a single object literal,
 * so V8 sees the full hidden class shape at construction time. Effects always run in lazy
 * mode (recompute is called explicitly by `effect()`), so we hardcode the lazy bits and skip
 * the auto-dispose CONFIG bit (effect() previously cleared it post-construction).
 */
export function createEffectNode<T>(
  fn: (prev?: T) => T,
  effectFn: (val: T, prev: T | undefined) => void | (() => void),
  errorFn: ((err: unknown, cleanup: () => void) => void | (() => void)) | undefined,
  type: number,
  notifyStatus: ((status?: number, error?: any) => void) | undefined,
  options: NodeOptions<T> | undefined
): any {
  const transparent = options?.transparent ?? false;
  const self = {
    id:
      options?.id ??
      (transparent ? context?.id : context?.id != null ? getNextChildId(context) : undefined),
    _config:
      (transparent ? CONFIG_TRANSPARENT : 0) |
      (options?.ownedWrite ? CONFIG_OWNED_WRITE : 0) |
      (options?.sync ? CONFIG_SYNC : 0) |
      (snapshotCaptureActive && ownerInSnapshotScope(context) ? CONFIG_IN_SNAPSHOT_SCOPE : 0),
    _equals: false as unknown as Computed<T>["_equals"],
    _unobserved: options?.unobserved,
    _disposal: null,
    _queue: context?._queue ?? globalQueue,
    _context: context?._context ?? defaultContext,
    _childCount: 0,
    _fn: fn,
    _value: undefined as T,
    _height: 0,
    _child: null,
    _nextHeap: undefined,
    _prevHeap: null as any,
    _deps: null,
    _depsTail: null,
    _depGen: 0,
    _subs: null,
    _subsTail: null,
    _parent: context,
    _nextSibling: null,
    _prevSibling: null,
    _firstChild: null,
    _flags: REACTIVE_LAZY,
    _statusFlags: STATUS_UNINITIALIZED,
    _time: clock,
    _pendingValue: NOT_PENDING,
    _pendingDisposal: null,
    _pendingFirstChild: null,
    _inFlight: null,
    _transition: null,
    _modified: false,
    _prevValue: undefined as T | undefined,
    _effectFn: effectFn,
    _errorFn: errorFn,
    _cleanup: undefined as (() => void) | undefined,
    _type: type,
    _notifyStatus: notifyStatus
  } as any;
  if (__DEV__) self._name = options?.name ?? "effect";
  setupComputedNode(self, lazyOptions);
  return self;
}

const lazyOptions = { lazy: true } as const;

function setupComputedNode<T>(self: Computed<T>, options: NodeOptions<T> | undefined): void {
  self._prevHeap = self;
  const parent = (context as Root)?._root
    ? (context as Root)._parentComputed
    : (context as Computed<any> | null);
  if (__DEV__ && context && context._config & CONFIG_CHILDREN_FORBIDDEN) {
    emitDiagnostic({
      code: "PRIMITIVE_IN_FORBIDDEN_SCOPE",
      kind: "lifecycle",
      severity: "error",
      message: PRIMITIVE_IN_FORBIDDEN_SCOPE_MESSAGE,
      ownerId: context.id,
      ownerName: (context as any)._name
    });
    throw new Error(PRIMITIVE_IN_FORBIDDEN_SCOPE_MESSAGE);
  }
  if (context) {
    const lastChild = context._firstChild;
    if (lastChild === null) {
      context._firstChild = self;
    } else {
      self._nextSibling = lastChild;
      lastChild._prevSibling = self;
      context._firstChild = self;
    }
  }
  if (__DEV__) DEV.hooks.onOwner?.(self);
  if (parent) self._height = parent._height + 1;
  if (externalSourceConfig) {
    const bridgeSignal = signal<undefined>(undefined, { equals: false, ownedWrite: true });
    const source = externalSourceConfig.factory(self._fn as any, () => {
      setSignal(bridgeSignal, undefined);
    });
    cleanup(() => source.dispose());
    self._fn = ((prev: any) => {
      read(bridgeSignal);
      return source.track(prev);
    }) as any;
  }
  !options?.lazy && recompute(self, true);
  if (snapshotCaptureActive && !options?.lazy) {
    if (!(self._statusFlags & STATUS_PENDING) && !(self._config & CONFIG_NO_SNAPSHOT)) {
      self._snapshotValue = self._value === undefined ? NO_SNAPSHOT : self._value;
      snapshotSources!.add(self);
    }
  }
}

export function signal<T>(v: T, options?: NodeOptions<T>): Signal<T>;
export function signal<T>(
  v: T,
  options?: NodeOptions<T>,
  firewall?: Computed<any>
): FirewallSignal<T>;
export function signal<T>(
  v: T,
  options?: NodeOptions<T>,
  firewall: Computed<unknown> | null = null
): Signal<T> {
  const s = {
    _equals: options?.equals != null ? options.equals : isEqual,
    _config:
      (options?.ownedWrite ? CONFIG_OWNED_WRITE : 0) |
      (options?._noSnapshot ? CONFIG_NO_SNAPSHOT : 0),
    _unobserved: options?.unobserved,
    _value: v,
    _subs: null,
    _subsTail: null,
    _time: clock,
    _firewall: firewall,
    _nextChild: firewall?._child || null,
    _pendingValue: NOT_PENDING
  };
  if (__DEV__) {
    (s as any)._name = options?.name ?? "signal";
    (s as any)._internal = !!firewall;
  }
  firewall && (firewall._child = s as FirewallSignal<unknown>);
  if (
    snapshotCaptureActive &&
    !(s._config & CONFIG_NO_SNAPSHOT) &&
    !((firewall?._statusFlags ?? 0) & STATUS_PENDING)
  ) {
    (s as any)._snapshotValue = v === undefined ? NO_SNAPSHOT : v;
    snapshotSources!.add(s);
  }
  return s as Signal<T>;
}

export function optimisticSignal<T>(v: T, options?: NodeOptions<T>): Signal<T> {
  const s = signal(v, options);
  s._overrideValue = NOT_PENDING;
  return s;
}

export function optimisticComputed<T>(
  fn: (prev?: T) => T | PromiseLike<T> | AsyncIterable<T>,
  options?: NodeOptions<T>
): Computed<T> {
  const c = computed(fn, options);
  c._overrideValue = NOT_PENDING;
  return c;
}

export function isEqual<T>(a: T, b: T): boolean {
  return a === b;
}

/**
 * When set to a component name string, any reactive read that is not inside a nested tracking
 * scope will log a dev-mode warning. Managed automatically by `untrack(fn, strictReadLabel)`.
 */
export let strictRead: string | false = false;
export function setStrictRead(v: string | false): string | false {
  const prev = strictRead;
  strictRead = v;
  return prev;
}

/**
 * Runs `fn` outside of any reactive tracking — reads inside `fn` will not
 * subscribe the current scope. Returns whatever `fn` returns.
 *
 * Use `untrack` inside a memo or effect when you need to read a signal once
 * without making the surrounding computation depend on its future changes.
 *
 * Pass a `strictReadLabel` string to enable a dev-mode warning: any reactive
 * read inside `fn` that isn't inside a nested tracking scope will log a
 * warning naming the label.
 *
 * @example
 * ```ts
 * createEffect(
 *   () => trigger(),                 // tracks `trigger` only
 *   () => {
 *     const snapshot = untrack(() => state); // read once, untracked
 *     log(snapshot);
 *   }
 * );
 * ```
 */
export function untrack<T>(fn: () => T, strictReadLabel?: string | false): T {
  if (!externalSourceConfig && !tracking && (!__DEV__ || (!strictRead && !strictReadLabel)))
    return fn();
  const prevTracking = tracking;
  const prevStrictRead = strictRead;
  tracking = false;
  if (__DEV__) strictRead = strictReadLabel || false;
  try {
    if (externalSourceConfig) return externalSourceConfig.untrack(fn);
    return fn();
  } finally {
    tracking = prevTracking;
    if (__DEV__) strictRead = prevStrictRead;
  }
}

/**
 * Bring a computed to a readable state: lazy/disposed nodes are (re)computed;
 * an isPending() probe (`refresh`) additionally pulls the node fully up to
 * date so its status flags reflect the current graph.
 */
function prepareComputed(comp: Computed<unknown>, refresh: boolean): void {
  if (comp._flags & REACTIVE_LAZY) {
    comp._flags &= ~REACTIVE_LAZY;
    recompute(comp as Computed<any>, true);
  } else if (comp._flags & REACTIVE_DISPOSED) {
    recompute(comp as Computed<any>, true);
  } else if (refresh) {
    updateIfNecessary(comp);
  }
}

export function read<T>(el: Signal<T> | Computed<T>): T {
  // Handle latest() mode: read from _latestValueComputed
  // Checked before isPending so that isPending(() => latest(x)) checks
  // the _pendingSignal of _latestValueComputed (async in flight) rather
  // than the original node (which stays "pending" while held in a transition).
  if (latestReadActive) {
    const pendingComputed = getLatestValueComputed(el);
    const prevPending = latestReadActive;
    latestReadActive = false;
    const visibleValue = (
      el._overrideValue !== undefined && el._overrideValue !== NOT_PENDING
        ? el._overrideValue
        : el._value
    ) as T;
    let value: T;
    try {
      value = read(pendingComputed);
    } catch (e) {
      // latest() falls back to the stale committed value while new async is in
      // flight — it must not suspend the reader (#2829). The only time it
      // suspends is when the source has never produced a value (initial load):
      // there is no stale value to show, so let Loading handle it.
      if (
        e instanceof NotReadyError &&
        (!context || !((el as Computed<T>)._statusFlags & STATUS_UNINITIALIZED))
      )
        return visibleValue;
      throw e;
    } finally {
      latestReadActive = prevPending;
    }
    if (pendingComputed._statusFlags & STATUS_PENDING) return visibleValue;
    // Cross-lane stale read: a child lane should keep seeing the parent's
    // committed value until the parent lane resolves.
    if (stale && currentOptimisticLane && pendingComputed._optimisticLane) {
      const pcLane = findLane(pendingComputed._optimisticLane);
      const curLane = findLane(currentOptimisticLane);
      if (pcLane !== curLane && pcLane._pendingAsync.size > 0) {
        return visibleValue;
      }
    }
    return value as T;
  }

  let c = context;
  if ((c as Root)?._root) c = (c as Root)._parentComputed;
  const computed = el as Partial<Computed<unknown>>;
  const firewall = (el as FirewallSignal<any>)._firewall;
  const owner = firewall || el;

  // Handle isPending() mode: collect pending state while preserving normal read semantics.
  // Probe mode is suspended while preparing the node so nested reads during a
  // recompute don't collect into the probe.
  if (pendingCheckActive) {
    pendingCheckActive = false;
    if (typeof computed._fn === "function") prepareComputed(el as Computed<unknown>, true);
    if (c && owner._statusFlags! & STATUS_PENDING && owner._statusFlags! & STATUS_UNINITIALIZED) {
      if (tracking && el !== c) link(el, c as Computed<any>);
      pendingCheckActive = true;
      throw (owner as Computed<any>)._error;
    }
    // Verdicts come uniformly from the collected sources' pending signals
    // (computePendingState); an active leaf override is not special-cased to
    // force `found` — the mask (A20 re-rule 2026-07-07c) reads it settled.
    collectPendingSources(el);
    if (firewall) collectPendingSources(firewall);
    pendingCheckActive = true;
  } else if (typeof computed._fn === "function") {
    prepareComputed(el as Computed<unknown>, false);
  }

  if (
    !computed._fn &&
    owner === el &&
    el._overrideValue === undefined &&
    el._snapshotValue === undefined &&
    activeTransition === null &&
    currentOptimisticLane === null &&
    !snapshotCaptureActive &&
    (!__DEV__ || !strictRead)
  ) {
    if (c && tracking) link(el, c as Computed<any>);
    return (!c || el._pendingValue === NOT_PENDING ? el._value : el._pendingValue) as T;
  }

  if (__DEV__ && strictRead && owner._statusFlags & STATUS_PENDING) {
    const message =
      `[PENDING_ASYNC_UNTRACKED_READ] Reading a pending async value directly in ${strictRead}. ` +
      `Async values must be read within a tracking scope (JSX, a memo, or an effect's compute function).`;
    emitDiagnostic({
      code: "PENDING_ASYNC_UNTRACKED_READ",
      kind: "async",
      severity: "error",
      message,
      ownerId: c?.id,
      ownerName: (c as any)?._name,
      nodeName: (owner as any)?._name,
      data: { strictRead }
    });
    throw new Error(message);
  }

  if (c && tracking) {
    link(el, c as Computed<any>, pendingCheckActive);

    if ((owner as Computed<unknown>)._fn) {
      const isZombie = (el as Computed<unknown>)._flags & REACTIVE_ZOMBIE;
      if (owner._height >= (isZombie ? zombieQueue._min : dirtyQueue._min)) {
        markNode(c as Computed<any>);
        markHeap(isZombie ? zombieQueue : dirtyQueue);
        updateIfNecessary(owner);
      }
      const height = owner._height;
      // parent check is shallow, might need to be recursive
      if (height >= (c as Computed<any>)._height && (el as Computed<any>)._parent !== c) {
        (c as Computed<any>)._height = height + 1;
      }
    }
  }

  if (owner._statusFlags & STATUS_PENDING) {
    if (c && !(stale && owner._transition && activeTransition !== owner._transition)) {
      if (__DEV__ && c && c._config & CONFIG_CHILDREN_FORBIDDEN) {
        const message =
          "[PENDING_ASYNC_FORBIDDEN_SCOPE] Reading a pending async value inside createTrackedEffect or onSettled will throw. " +
          "Use createEffect instead which supports async-aware reactivity.";
        emitDiagnostic({
          code: "PENDING_ASYNC_FORBIDDEN_SCOPE",
          kind: "async",
          severity: "warn",
          message,
          ownerId: c.id,
          ownerName: (c as any)._name,
          nodeName: (owner as any)?._name
        });
        console.warn(message);
      }
      if (currentOptimisticLane) {
        // Per-lane suspension: only throw if in same lane as pending async
        // AND the node doesn't have an active override (overrides are the visible value,
        // downstream in the lane should read the override, not throw)
        const pendingLane = (owner as any)._optimisticLane;
        const lane = findLane(currentOptimisticLane);
        if (pendingLane && findLane(pendingLane) === lane && !hasActiveOverride(owner)) {
          if (!tracking && el !== c) link(el, c as Computed<any>);
          throw owner._error;
        }
      } else {
        if (!tracking && el !== c) link(el, c as Computed<any>);
        throw owner._error;
      }
    } else if (c && owner !== el && owner._statusFlags & STATUS_UNINITIALIZED) {
      if (!tracking && el !== c) link(el, c as Computed<any>);
      throw owner._error;
    } else if (!c && owner._statusFlags & STATUS_UNINITIALIZED) {
      throw owner._error;
    }
  }
  if ((el as Computed<any>)._fn && (el as Computed<any>)._statusFlags & STATUS_ERROR) {
    // Only a genuine reactive re-read may retry an errored async source:
    // - tracking: owned/tracked scope only (never events / `untrack` / effect side-effect phase)
    // - !pendingCheckActive: an `isPending` probe observes the error, never refetches
    // - el._time < clock: only on a later cycle than the one the error was found
    if (tracking && !pendingCheckActive && el._time < clock) {
      recompute(el as Computed<unknown>);
      return read(el);
    } else throw (el as Computed<any>)._error;
  }

  if (snapshotCaptureActive && c && (c as Computed<any>)._config & CONFIG_IN_SNAPSHOT_SCOPE) {
    const sv = el._snapshotValue;
    if (sv !== undefined) {
      const snapshot = sv === NO_SNAPSHOT ? undefined : sv;
      const current = el._pendingValue !== NOT_PENDING ? el._pendingValue : el._value;
      if (current !== snapshot) (c as Computed<any>)._flags |= REACTIVE_SNAPSHOT_STALE;
      return snapshot as T;
    }
  }

  if (__DEV__ && strictRead) {
    const message =
      `[STRICT_READ_UNTRACKED] Reactive value read directly in ${strictRead} will not update. ` +
      `Move it into a tracking scope (JSX, a memo, or an effect's compute function).`;
    emitDiagnostic({
      code: "STRICT_READ_UNTRACKED",
      kind: "strict-read",
      severity: "warn",
      message,
      ownerId: c?.id,
      ownerName: (c as any)?._name,
      nodeName: (owner as any)?._name,
      data: { strictRead }
    });
    console.warn(message);
  }

  if (el._overrideValue !== undefined && el._overrideValue !== NOT_PENDING) {
    if (c && stale && shouldReadStashedOptimisticValue(el as Signal<any>)) return el._value as T;
    return el._overrideValue as T;
  }

  // Entanglement gate: a reader recomputing under an optimistic lane that reads
  // a pending mid-transition write sees the committed value. Projection-store
  // manual writes use the firewall's manual-write flag to opt into this path.
  // Async drivers are not under an optimistic lane and so bypass this, reading
  // _pendingValue for correct fetching. The sub is recorded for replay at commit
  // so it re-runs with the new committed view.
  if (
    activeTransition !== null &&
    currentOptimisticLane !== null &&
    !latestReadActive &&
    el._pendingValue !== NOT_PENDING &&
    (owner === el || !!((owner as Computed<unknown>)._flags & REACTIVE_MANUAL_WRITE)) &&
    !(el as Partial<Computed<unknown>>)._fn &&
    c
  ) {
    activeTransition._gatedSubs.add(c as Computed<any>);
    return el._value as T;
  }

  // In optimistic lane context, return _value for optimistic/lane-assigned signals
  // and for regular signals in stale mode (render effects). Non-stale readers (user
  // effects) see _pendingValue so that latest() and direct reads stay consistent.
  // Exception: resolved projection store properties (firewall, owner !== el) whose
  // STATUS_PENDING has been cleared always return _pendingValue.
  // The latest() shadow computed (`c._parentSource === el`) always wants the
  // in-flight value: it may recompute under a stale/lane context inherited from
  // whichever flush ran it, and must not cache the committed value there (#2829).
  const value =
    !c ||
    (currentOptimisticLane !== null &&
      (el._overrideValue !== undefined ||
        (el as any)._optimisticLane ||
        (owner === el && stale && (c as Computed<any>)._parentSource !== el) ||
        !!(owner._statusFlags & STATUS_PENDING))) ||
    el._pendingValue === NOT_PENDING ||
    (stale && el._transition && activeTransition !== el._transition)
      ? el._value
      : (el._pendingValue as T);
  // Record that this isPending() probe observed the fresh pending value, so
  // the probe doesn't pair "pending" with the new value (#2831).
  if (
    pendingCheckActive &&
    pendingProbe !== null &&
    el._pendingValue !== NOT_PENDING &&
    value === el._pendingValue
  )
    pendingProbe.freshReads.add(el);
  if (
    !c &&
    owner === el &&
    typeof computed._fn === "function" &&
    el._config & CONFIG_AUTO_DISPOSE &&
    !(owner._statusFlags & STATUS_PENDING) &&
    !el._subs
  ) {
    unobserved(el as Computed<unknown>);
  }
  return value;
}

export function setSignal<T>(el: Signal<T> | Computed<T>, v: T | ((prev: T) => T)): T {
  if (
    __DEV__ &&
    !(el._config & CONFIG_OWNED_WRITE) &&
    !(context && context._config & CONFIG_CHILDREN_FORBIDDEN) &&
    context &&
    (el as FirewallSignal<any>)._firewall !== context
  ) {
    emitDiagnostic({
      code: "REACTIVE_WRITE_IN_OWNED_SCOPE",
      kind: "write",
      severity: "error",
      message: REACTIVE_WRITE_IN_OWNED_SCOPE_SIGNAL_MESSAGE,
      ownerId: context.id,
      ownerName: (context as any)._name,
      nodeName: (el as any)._name,
      data: { operation: "setSignal" }
    });
    throw new Error(REACTIVE_WRITE_IN_OWNED_SCOPE_SIGNAL_MESSAGE);
  }

  if (el._transition && activeTransition !== el._transition)
    globalQueue.initTransition(el._transition);

  const isOptimistic = el._overrideValue !== undefined && !projectionWriteActive;
  const hasOverride = el._overrideValue !== undefined && el._overrideValue !== NOT_PENDING;
  const currentValue = isOptimistic
    ? hasOverride
      ? (el._overrideValue as T)
      : el._value
    : el._pendingValue === NOT_PENDING
      ? el._value
      : (el._pendingValue as T);

  if (typeof v === "function") v = (v as (prev: T) => T)(currentValue);

  // Uninitialized check first: the first commit has no previous value, so the
  // user comparator must not run against `undefined` (matches recompute).
  const valueChanged =
    !!((el as Computed<T>)._statusFlags & STATUS_UNINITIALIZED) ||
    !el._equals ||
    !el._equals(currentValue, v);
  if (!valueChanged) {
    // Same-value write with an active override still entangles the current
    // action's transition — the hold must outlast all overlapping actions.
    if (isOptimistic && hasOverride) {
      const transition = resolveTransition(el as any);
      if (transition && activeTransition !== transition) globalQueue.initTransition(transition);
    }
    return v;
  }

  if (isOptimistic) {
    const firstOverride = el._overrideValue === NOT_PENDING;
    if (!firstOverride) globalQueue.initTransition(resolveTransition(el as any));
    // No revert target is stashed: while the override is active every reader
    // sees it (A17), so authoritative arrivals commit silently into _value and
    // reverting is just dropping the override — _value is already correct.
    if (firstOverride) globalQueue._optimisticNodes.push(el);

    const lane = getOrCreateLane(el);
    el._optimisticLane = lane;

    el._overrideValue = v;
    if (__DEV__) devTrackOptimistic(el);
  } else {
    if (el._pendingValue === NOT_PENDING) queuePendingNode(el);
    el._pendingValue = v;
    if (__DEV__) devTrackHeldPending(el);
  }

  syncCompanions(el, v);

  el._time = clock;
  insertSubs(el, isOptimistic);
  schedule();
  return v;
}

/**
 * Suppresses automatic recomputation of `el` until the scheduler drains. Used
 * when a manual write should win over dependency changes queued in the same
 * tick. The MANUAL_WRITE flag is cleared by the pending-node drain; projection
 * computeds don't commit values, but they still need the same end-of-tick
 * cleanup point.
 */
export function suppressComputedRecompute(el: Computed<unknown>): void {
  deleteFromHeap(el, el._flags & REACTIVE_ZOMBIE ? zombieQueue : dirtyQueue);
  if (!(el._flags & REACTIVE_MANUAL_WRITE) && el._pendingValue === NOT_PENDING) {
    queuePendingNode(el);
    schedule();
  }
  el._flags = (el._flags & ~(REACTIVE_DIRTY | REACTIVE_CHECK)) | REACTIVE_MANUAL_WRITE;
}

/**
 * User-facing setter for the memo form of `createSignal(fn)`. Behaves like
 * `setSignal`, but also cancels any pending recompute of the memo so the
 * manual value wins over a value that would otherwise be produced by an
 * upstream change in the same tick.
 */
export function setMemo<T>(el: Computed<T>, v: T | ((prev: T) => T)): T {
  const result = setSignal(el, v);
  suppressComputedRecompute(el as Computed<unknown>);
  return result;
}

/**
 * Executes `fn` with the given `owner` set as the current owner. Any reactive
 * primitives (`createSignal`, `createMemo`, `createEffect`, `onCleanup`,
 * `cleanup`, etc.) created inside `fn` are attached to that owner, so they
 * are disposed when the owner is disposed.
 *
 * The classic pattern: capture the current owner with `getOwner()` inside a
 * component, then re-enter it from a callback (event handler, async resolve,
 * setTimeout) so disposables created in the callback get cleaned up with the
 * component.
 *
 * @example
 * ```ts
 * function delayed<T>(ms: number, fn: () => T) {
 *   const owner = getOwner();
 *   setTimeout(() => runWithOwner(owner, fn), ms);
 * }
 * ```
 */
export function runWithOwner<T>(owner: Owner | null, fn: () => T): T {
  if (__DEV__ && owner && (owner as any)._flags & REACTIVE_DISPOSED) {
    const message =
      "[RUN_WITH_DISPOSED_OWNER] runWithOwner called with a disposed owner. Children created inside will never be disposed.";
    emitDiagnostic({
      code: "RUN_WITH_DISPOSED_OWNER",
      kind: "owner",
      severity: "warn",
      message,
      ownerId: owner.id,
      ownerName: (owner as any)._name
    });
    console.warn(message);
  }
  const oldContext = context;
  const prevTracking = tracking;
  context = owner;
  tracking = false;
  try {
    return fn();
  } finally {
    context = oldContext;
    tracking = prevTracking;
  }
}

/**
 * Get or create the pending signal for a node (lazy).
 * Used by isPending() to track pending state reactively.
 */
function getPendingSignal(el: Signal<any> | Computed<any>): Signal<boolean> {
  if (!el._pendingSignal) {
    // Start false, write true if pending - ensures reversion returns to false
    el._pendingSignal = optimisticSignal(false, { ownedWrite: true });
    // Back-reference to the owner: parent-child lane relationship (companion
    // lanes never merge with the owner's lane) and the settlement checkpoint
    // (resolveOptimisticNodes re-derives a reverted companion from its owner).
    el._pendingSignal._parentSource = el;
    if (computePendingState(el)) setSignal(el._pendingSignal, true);
    if (__DEV__) devTrackCompanionOwner(el);
  }
  return el._pendingSignal;
}

function collectPendingSources(el: Signal<any> | Computed<any>): void {
  if (!pendingProbe) return;
  pendingProbe.sources.add(el);
  const owner = (el as FirewallSignal<any>)._firewall || el;
  if (owner !== el) pendingProbe.sources.add(owner);
}

/**
 * Compute whether a node is in "pending" state.
 *
 * The rule (A20, re-ruled 2026-07-07c): a node is pending iff the value the
 * reader observes is going to be superseded by work already in motion.
 * - Plain reads watch the committed channel: pending during an in-flight
 *   fetch AND while a resolved value is still held by its transition.
 * - `latest` reads watch the fresh channel (the shadow, `_parentSource`
 *   branch): they already show held values, so only actually-in-flight async
 *   supersedes them.
 * - An active optimistic override is certainty by decree: the writer declared
 *   the value not-superseded, so the node reads false for the override's
 *   whole lifetime (the mask). Action-scoped "saving" affordances belong in
 *   the data (co-written flags), never in verdicts.
 * Returns false for initial async loads (no stale data to show — loading, not
 * pending) and for disposed nodes (a dead source can never settle).
 */
function computePendingState(el: Signal<any> | Computed<any>): boolean {
  const comp = el as Computed<any>;
  // A verdict is a property of live data: a disposed source can never settle,
  // so it is never pending (INV-9 — a latched true would hold a spinner
  // forever; the PR #2845 disposal edge).
  if (comp._flags & REACTIVE_DISPOSED) return false;
  const firewall = (el as FirewallSignal<any>)._firewall;
  // Store-wide mask: the store is the primitive, so an optimistic write
  // decrees the WHOLE store settled — firewall, written leaves, untouched
  // siblings, structural reads — for the lifetime of the override/transition.
  // "Once you write optimistically you manage your own pending state."
  if (((firewall || comp) as Computed<any>)._optimisticMask) return false;
  if (el._parentSource) {
    // The latest() shadow's verdict: pending follows the channel you read
    // (A20), and the latest view is the fresh channel — it already shows
    // transition-held values, so a hold cannot supersede what it shows. It
    // reads pending only while async that will replace what it shows is
    // actually in flight ("false as soon as that async is done, even if the
    // same update has other async still running").
    const parentNode = el._parentSource as FirewallSignal<any>;
    // Mask (A20): an active override IS the value by decree — nothing in
    // motion supersedes it, including its own firewall's refetch.
    if (hasActiveOverride(parentNode)) return false;
    // A store leaf's async status lives on its firewall, not the leaf signal
    // itself (#2831). A leaf downstream of an in-flight refetch is pending in
    // both forms — the latest view strips holds, never in-flight async.
    const parent = (parentNode._firewall || parentNode) as Computed<any>;
    if (parent._optimisticMask) return false;
    return !!(
      parent._statusFlags & STATUS_PENDING && !(parent._statusFlags & STATUS_UNINITIALIZED)
    );
  }
  // Mask (A20, re-ruled 2026-07-07c): an active override is certainty by
  // decree — writing it declares the shown value not-superseded, so the node
  // is never pending while it holds, no matter what async is in motion around
  // it. Action-scoped "saving" affordances belong in the data (co-written
  // flags), not in verdicts.
  if (hasActiveOverride(el)) return false;
  // A held store leaf defers to its firewall: when the firewall's own work is
  // in flight the firewall carries the verdict (probes collect it alongside
  // the leaf — #2831), so the leaf reports only holds the firewall does NOT
  // explain: manual projection writes, or holds outliving a settled firewall.
  // Without this, leaf companions flip in lockstep with the firewall and
  // churn duplicate effect runs during initial projection loads.
  if (firewall && el._pendingValue !== NOT_PENDING) {
    return (
      !!(firewall._flags & REACTIVE_MANUAL_WRITE) ||
      (!firewall._inFlight && !(firewall._statusFlags & STATUS_PENDING))
    );
  }
  // Upstream: value held in transition (not during initial load). Applies to
  // resting optimistic nodes too (V1/A13): revert targets no longer exist
  // (2026-07-07b — every held value is a pending commit), so a held value is
  // always a transition/refetch hold and reads pending, exactly like a plain
  // async memo (the #2799 carve-out that skipped this for resting optimistic
  // nodes muted entangled refetch holds and was removed with the #2838 work).
  if (el._pendingValue !== NOT_PENDING && !(comp._statusFlags & STATUS_UNINITIALIZED)) return true;
  // Downstream: async in flight with previous value (not initial load)
  // STATUS_UNINITIALIZED is cleared on first successful completion
  return !!(comp._statusFlags & STATUS_PENDING && !(comp._statusFlags & STATUS_UNINITIALIZED));
}

/**
 * Keep the lazily-created isPending()/latest() companion nodes in sync with a
 * new value. Every path that produces a value for `el` — direct set, async
 * resolution, transition-held sync recompute — must route through here so a
 * new write path can't silently skip the companions (#2831).
 */
export function syncCompanions<T>(el: Signal<T> | Computed<T>, value: T): void {
  if (el._pendingSignal) updatePendingSignal(el);
  if (el._latestValueComputed) setSignal(el._latestValueComputed, value);
}

/**
 * Update _pendingSignal when pending state changes. When the override clears
 * (pending -> not pending), merge the sub-lane into the source's lane so
 * isPending effects are blocked until the full scope resolves.
 */
export function updatePendingSignal(el: Signal<any> | Computed<any>): void {
  if (el._pendingSignal) {
    setSignal(el._pendingSignal, computePendingState(el));
  }
  // The latest() shadow's own verdict derives from the owner (its
  // computePendingState consults `_parentSource`), so any owner state change
  // that lands here must flow through to the shadow's companion too (#2838).
  if (el._latestValueComputed) updatePendingSignal(el._latestValueComputed);
}

/**
 * A firewall's status change re-derives the verdicts of its probed leaves:
 * leaf companions consult the firewall (broad inheritance), so async
 * starting/settling on the firewall must poke them or they keep a stale
 * verdict forever (V4 stuck-companion class, #2838).
 */
export function updateChildCompanions(el: Computed<any>): void {
  for (
    let child: FirewallSignal<any> | null = el._child;
    child !== null;
    child = child._nextChild
  ) {
    if (child._pendingSignal || child._latestValueComputed) updatePendingSignal(child);
  }
}

/**
 * Settlement checkpoint (#2838): re-derive a node's companions directly from
 * its committed state. Called when the transition machinery for the node is
 * done with it — a pending commit or an optimistic revert. Verdicts are
 * written committed (not through setSignal) because a transition-scoped
 * override window opened here would itself need a settlement, re-scheduling
 * forever while async is still in flight. This is what keeps companions
 * coherent past transition completion: a verdict is a property of the data
 * (A19), so it must survive the transition that happened to produce it.
 */
export function snapCompanionsToState(owner: Signal<any> | Computed<any>): void {
  const sig = owner._pendingSignal;
  // An active override on the companion belongs to a transition that is still
  // running; its own settlement re-enters here after the revert.
  if (sig && (sig._overrideValue === undefined || sig._overrideValue === NOT_PENDING)) {
    const pending = computePendingState(owner);
    if (sig._value !== pending || sig._pendingValue !== NOT_PENDING) {
      sig._value = pending;
      sig._pendingValue = NOT_PENDING;
      sig._time = clock;
      insertSubs(sig);
      schedule();
    }
  }
  const shadow = owner._latestValueComputed;
  if (shadow && !(shadow._flags & REACTIVE_DISPOSED)) {
    // The shadow may have cached a mid-transition view (a stale committed
    // value read under a lane — the V2 read-order freeze) that no write path
    // will ever correct. Invalidate it so the next read re-derives from
    // committed state — but only when its committed value actually diverged;
    // a shadow with an active override (or already holding the right value)
    // is coherent and dirtying it mid-settlement would leak a half-settled
    // view to subscribers.
    if (
      (shadow._overrideValue === undefined || shadow._overrideValue === NOT_PENDING) &&
      shadow._pendingValue === NOT_PENDING &&
      !Object.is(shadow._value, owner._value) &&
      !(shadow._flags & (REACTIVE_DIRTY | REACTIVE_CHECK))
    ) {
      shadow._flags |= REACTIVE_DIRTY;
      insertIntoHeap(shadow, shadow._flags & REACTIVE_ZOMBIE ? zombieQueue : dirtyQueue);
      insertSubs(shadow);
      schedule();
    }
    snapCompanionsToState(shadow);
  }
}

/**
 * Get or create the latest value computed for a node (lazy).
 * Used by latest() to read the in-flight value during a transition.
 */
function getLatestValueComputed<T>(el: Signal<T> | Computed<T>): Computed<T> {
  if (!el._latestValueComputed) {
    // Save and restore context flags to prevent leaking isPending/latest
    // context into the computed's initial recompute.
    const prevPending = latestReadActive;
    latestReadActive = false;
    const prevCheck = pendingCheckActive;
    pendingCheckActive = false;
    const prevContext = context;
    context = null; // Detach from owner so it isn't disposed with effects
    el._latestValueComputed = optimisticComputed(() => read(el));
    el._latestValueComputed._parentSource = el; // Parent-child lane relationship
    if (__DEV__) devTrackCompanionOwner(el);
    context = prevContext;
    pendingCheckActive = prevCheck;
    latestReadActive = prevPending;
  }
  return el._latestValueComputed;
}

export function staleValues<T>(fn: () => T, set = true): T {
  const prevStale = stale;
  stale = set;
  try {
    return fn();
  } finally {
    stale = prevStale;
  }
}

/**
 * Reads reactive expressions while bypassing any pending async overlay — i.e.
 * always returns the most-recently-committed value, even when newer reads
 * inside `fn` are still in flight.
 *
 * Useful inside a `<Loading>` boundary's children when you want to keep
 * showing the previous resolved data instead of the fallback while the next
 * value loads.
 *
 * @example
 * ```tsx
 * <Loading fallback={<Skeleton />}>
 *   {/* During a transition, render the previous user instead of skeleton: *\/}
 *   <UserCard user={latest(() => user())} />
 * </Loading>
 * ```
 */
export function latest<T>(fn: () => T): T {
  const prevLatest = latestReadActive;
  latestReadActive = true;
  try {
    return fn();
  } finally {
    latestReadActive = prevLatest;
  }
}

/**
 * Returns `true` if any reactive read inside `fn` is showing a stale value
 * while newer async work is pending. Does not subscribe — pair with a tracked
 * memo if you want to react to pending status changes.
 *
 * Useful for showing inline transition indicators alongside the previous
 * value (rather than swapping to a `<Loading>` fallback).
 * Because `fn` is read normally, `isPending` participates in Loading/SSR
 * readiness the same way the read itself would.
 *
 * @example
 * ```tsx
 * const pending = createMemo(() => isPending(() => user()));
 *
 * <button disabled={pending()}>{pending() ? "Saving…" : "Save"}</button>
 *
 * <button disabled={isPending(() => user())}>Save</button>
 * ```
 */
export function isPending(fn: () => any): boolean {
  const prevPendingCheck = pendingCheckActive;
  const prevProbe = pendingProbe;
  pendingCheckActive = true;
  const probe: PendingProbe = (pendingProbe = {
    found: false,
    sources: new Set(),
    freshReads: new Set()
  });
  const collectPending = () => {
    pendingCheckActive = false;
    const prevStrictRead = __DEV__ ? strictRead : false;
    if (__DEV__) strictRead = false;
    try {
      probe.sources.forEach(source => {
        // Pair consistency: if the probe's read of this source observed the
        // fresh transition-held `_pendingValue` (non-stale readers such as
        // user effects do), the value is not stale to this reader and must
        // not be reported as pending — otherwise [isPending(x), x()] pairs
        // pending with the new value (#2831). Readers that observed the
        // committed (stale) value keep the signal's verdict.
        if (read(getPendingSignal(source)) && !probe.freshReads.has(source)) probe.found = true;
      });
    } finally {
      if (__DEV__) strictRead = prevStrictRead;
      pendingCheckActive = true;
    }
  };
  try {
    fn();
    collectPending();
    return probe.found;
  } catch (e) {
    collectPending();
    if (e instanceof NotReadyError) {
      if (probe.found && !(e.source?._statusFlags & STATUS_UNINITIALIZED)) return true;
      if (context) throw e;
    }
    // When a thunk throws during pending check (e.g., accessing undefined values
    // from uninitialized async memos), return probe.found. The error indicates
    // we're reading from something not yet ready.
    return probe.found;
  } finally {
    pendingCheckActive = prevPendingCheck;
    pendingProbe = prevProbe;
  }
}

/**
 * Invalidates one reactive source, forcing it to re-execute even if its inputs
 * haven't changed.
 *
 * Pass either a Solid-created accessor or a projected store created from
 * `createStore(fn, ...)` / `createProjection(...)`. `refresh()` is a
 * write-like invalidation operation: it does not read the target's value, and
 * refreshing a plain signal accessor is a no-op.
 *
 * Use it to invalidate cached async values (e.g. force a re-fetch) without
 * tearing the consumer down.
 *
 * @example
 * ```ts
 * const user = createMemo(async () => fetch(`/users/${id()}`).then(r => r.json()));
 *
 * // Re-fetch on demand
 * <button onClick={() => refresh(user)}>Reload</button>
 * ```
 */
export function refresh<T>(target: Refreshable<T>): void {
  const node = (target as any)?.[$REFRESH] as Computed<any> | undefined;
  if (!node) {
    if (__DEV__) {
      const message =
        "[INVALID_REFRESH_TARGET] refresh() expects a Solid source accessor or refreshable store. " +
        "Pass the original source target, not a wrapper function or derived property read.";
      emitDiagnostic({
        code: "INVALID_REFRESH_TARGET",
        kind: "write",
        severity: "error",
        message
      });
      throw new Error(message);
    }
    return;
  }
  if (
    __DEV__ &&
    context &&
    !((node._config ?? 0) & CONFIG_OWNED_WRITE) &&
    !(context._config & CONFIG_CHILDREN_FORBIDDEN)
  ) {
    emitDiagnostic({
      code: "REACTIVE_WRITE_IN_OWNED_SCOPE",
      kind: "write",
      severity: "error",
      message: REACTIVE_WRITE_IN_OWNED_SCOPE_REFRESH_MESSAGE,
      ownerId: context.id,
      ownerName: (context as any)._name,
      nodeName: (node as any)._name,
      data: { operation: "refresh" }
    });
    throw new Error(REACTIVE_WRITE_IN_OWNED_SCOPE_REFRESH_MESSAGE);
  }
  if (
    typeof node._fn === "function" &&
    !(node._flags & (REACTIVE_DISPOSED | REACTIVE_MANUAL_WRITE))
  ) {
    node._flags = (node._flags & ~REACTIVE_CHECK) | REACTIVE_DIRTY;
    insertIntoHeap(node, node._flags & REACTIVE_ZOMBIE ? zombieQueue : dirtyQueue);
    schedule();
  }
}
