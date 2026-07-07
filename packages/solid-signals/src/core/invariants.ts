import {
  NOT_PENDING,
  REACTIVE_CHECK,
  REACTIVE_DIRTY,
  REACTIVE_DISPOSED,
  STATUS_PENDING
} from "./constants.js";
import { assertInvariant } from "./dev.js";
import type { OptimisticLane } from "./lanes.js";
import type { Computed, Signal } from "./types.js";

/**
 * Test-mode invariant checks for the async/transition/lane machinery.
 * Catalog and rationale: packages/solid-signals/INTERNALS-ASYNC-STATE.md.
 *
 * These are implementation self-consistency checks, not semantic rules: a
 * violation means the reactive system contradicted itself.
 *
 * They are gated on `__TEST__` (not just `__DEV__`): the per-write Set
 * tracking and per-flush quiescence sweep are too expensive for shipped dev
 * builds and for benchmarks (they showed up as a 5-21% hit across the
 * CodSpeed suite when they ran under `__DEV__`). Call sites stay `__DEV__`
 * guarded so production tree-shakes the calls; each entry point here
 * early-returns unless `__TEST__` is set, so dev builds pay only a no-op
 * call. The test suite (vitest run) defines `__TEST__: true`; benchmark mode
 * defines `__TEST__: false`.
 */

type AnyNode = Signal<any> | Computed<any>;

// Plain signals carry no _flags; `undefined & N` is 0 (not disposed).
function isDisposed(node: AnyNode): boolean {
  return !!((node as Computed<any>)._flags & REACTIVE_DISPOSED);
}

/** Wired by core.ts at module init to avoid import cycles. */
export const InvariantHooks: {
  pendingProbeActive: (() => boolean) | null;
} = { pendingProbeActive: null };

// INV-7: nodes that received a transition-held `_pendingValue`. A node still
// holding one at quiescence with no queued commit is a leak (#2827 class).
const heldPendingNodes = new Set<AnyNode>();

// INV-4: nodes that own isPending()/latest() companions, checked for
// companion coherence at quiescence (#2831 class).
const companionOwners = new Set<AnyNode>();

// INV-6: nodes that received an optimistic override. At quiescence every
// override must have reverted (overrides never outlive their transition).
const optimisticNodes = new Set<AnyNode>();

export function devTrackHeldPending(node: AnyNode): void {
  if (!__TEST__) return;
  heldPendingNodes.add(node);
}

export function devTrackCompanionOwner(node: AnyNode): void {
  if (!__TEST__) return;
  companionOwners.add(node);
}

export function devTrackOptimistic(node: AnyNode): void {
  if (!__TEST__) return;
  optimisticNodes.add(node);
}

// INV-3: transition async blockers may only be registered from the queue
// notification path (see .cursor/rules/async-registration-invariants.mdc).
// The transition's reporter map is dev-checked: writes outside an
// `allowAsyncReporterWrites` window assert.
let asyncReporterWritesAllowed = false;

/**
 * Open/close the sanctioned registration window. Call sites are `__DEV__`
 * guarded (no prod cost); the code inside the window must not throw.
 */
export function beginAsyncReporterWrites(): void {
  asyncReporterWritesAllowed = true;
}

export function endAsyncReporterWrites(): void {
  asyncReporterWritesAllowed = false;
}

class CheckedReportersMap extends Map<Computed<any>, Set<Computed<any>>> {
  set(key: Computed<any>, value: Set<Computed<any>>): this {
    assertInvariant(
      asyncReporterWritesAllowed,
      "INV-3",
      "transition._asyncReporters written outside the queue notification path — async blockers must only register from render-effect notification"
    );
    return super.set(key, value);
  }
}

export function createAsyncReporters(): Map<Computed<any>, Set<Computed<any>>> {
  return __TEST__ ? new CheckedReportersMap() : new Map();
}

/** INV-1: an isPending() probe must never leak past its own call. */
export function devCheckFlushStart(): void {
  if (!__TEST__) return;
  assertInvariant(
    !InvariantHooks.pendingProbeActive?.(),
    "INV-1",
    "pendingProbe is set at flush start — an isPending() probe leaked (missing restore in a throw path?)"
  );
}

/** INV-5: a merged lane's work moved to its root on merge and must stay empty. */
export function devCheckMergedLaneEmpty(lane: OptimisticLane): void {
  if (!__TEST__ || !lane._mergedInto) return;
  assertInvariant(
    lane._pendingAsync.size === 0 &&
      lane._effectQueues[0].length === 0 &&
      lane._effectQueues[1].length === 0,
    "INV-5",
    "a merged (non-root) lane accumulated pendingAsync/effects — work was routed past findLane()"
  );
}

/**
 * Quiescence checks. Run only when the system is fully drained: nothing
 * scheduled, no active/stashed transitions, no live lanes. At that point no
 * transition-scoped state may survive, and the lazily-created companions must
 * agree with a fresh computation of their owner's state.
 */
export function devCheckQuiescent(isQueuedForCommit: (node: AnyNode) => boolean): void {
  if (!__TEST__) return;
  for (const node of heldPendingNodes) {
    if (isDisposed(node) || node._pendingValue === NOT_PENDING) {
      heldPendingNodes.delete(node);
      continue;
    }
    // Queued nodes commit on the next flush; everything else is unreachable.
    assertInvariant(
      isQueuedForCommit(node),
      "INV-7",
      "a node holds a _pendingValue at quiescence with no queued commit and no transition — the value can never commit (leak, #2827 class)"
    );
  }

  for (const node of optimisticNodes) {
    if (isDisposed(node)) {
      optimisticNodes.delete(node);
      continue;
    }
    assertInvariant(
      node._overrideValue === undefined || node._overrideValue === NOT_PENDING,
      "INV-6",
      "an optimistic override survived to quiescence — resolveOptimisticNodes missed the node (its transition completed without reverting it)"
    );
  }

  for (const node of companionOwners) {
    if (isDisposed(node)) {
      companionOwners.delete(node);
      continue;
    }
    // Companion coherence is only asserted for *settled* owners (no async in
    // flight, no held pending value, no active override). The converse — what
    // the companion should read while async is in flight after its transition
    // already completed (pure signals graphs have no render-effect reporters,
    // so transitions complete immediately) — is a semantic question tracked in
    // INTERNALS-ASYNC-STATE.md §6, not a self-consistency invariant.
    const settled =
      !((node as Computed<any>)._statusFlags & STATUS_PENDING) &&
      node._pendingValue === NOT_PENDING &&
      (node._overrideValue === undefined || node._overrideValue === NOT_PENDING);
    if (!settled) continue;

    const pendingSignal = node._pendingSignal;
    if (pendingSignal) {
      assertInvariant(
        pendingSignal._value === false &&
          (pendingSignal._overrideValue === undefined ||
            pendingSignal._overrideValue === NOT_PENDING),
        "INV-4",
        "isPending companion reports pending for a fully settled node at quiescence — a clear path skipped updatePendingSignal (#2831 class)"
      );
    }
    const shadow = node._latestValueComputed;
    // Only check a settled shadow: a dirty/check-marked shadow legitimately
    // lags until its next lazy recompute.
    if (shadow && !(shadow._flags & (REACTIVE_DIRTY | REACTIVE_CHECK | REACTIVE_DISPOSED))) {
      assertInvariant(
        Object.is(shadow._value, node._value) || shadow._pendingValue !== NOT_PENDING,
        "INV-4",
        "latest() shadow computed holds a stale committed value for a settled node at quiescence — a write path skipped syncCompanions (#2831 class)"
      );
    }
  }
}
