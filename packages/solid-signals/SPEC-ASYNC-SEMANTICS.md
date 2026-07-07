# Async/Pending/Transition Semantics — Spec Propositions

Companion to `INTERNALS-ASYNC-STATE.md`. Each proposition is a testable,
user-observable behavior statement about `isPending` / `latest` / transitions /
optimistic lanes.

- **Tier A** — has a citable ruling or design decision. Pinned by tests that
  should be treated as *spec*: changing them requires a design decision, not a
  code fix. Do not "update expectations" here to make an implementation change
  pass.
- **Tier B** — believed correct but *inferred* from code/issues. Needs a
  maintainer verdict (keep / change) before promotion to Tier A.
- **Tier C** — genuinely open. Current behavior documented; a decision is
  needed either way.

## Tier A (ruled — pinned)

| # | Proposition | Ruling | Pinned by |
| --- | --- | --- | --- |
| A1 | `EffectBundle.error` intercepts compute-phase errors only; effect-phase throws escalate to the nearest error boundary (halt if none). | #2839 ruling (2026-07-06) | `tests/effect-error-phases.test.ts` |
| A2 | Compute-phase errors in *user* effects without a handler are logged and the run is skipped; the system keeps running. | #2839 ruling | `tests/effect-error-phases.test.ts` |
| A3 | Errors thrown by a user `equals` comparator behave exactly like compute-phase errors (boundary-containable; loud halt without a boundary). | #2837 | `tests/equals-comparator-errors.test.ts` |
| A4 | A custom `equals` is never invoked with `undefined` previous value on a node's first commit. | #2837 follow-on | `tests/equals-comparator-errors.test.ts` (async case) |
| A5 | An error escaping every boundary permanently halts the system with `REACTIVITY_HALTED`; later writes log "Update ignored". | #2761/#2762 | `tests/createErrorBoundary.test.ts`, `tests/errorHalt.test.ts` |
| A6 | `ASYNC_OUTSIDE_LOADING_BOUNDARY` is a warn-only diagnostic; an `Errored` above must not swallow it and must not show its fallback for a pending. | #2822 | `tests/enforceLoadingBoundary.test.ts`, solid-web `test/dev-warning.spec.tsx` |
| A7 | After an async memo resolves, `[isPending(x), latest(x)]` is `[false, resolvedValue]` — never `[false, undefined]`. | #2829 (the `[false, undefined]` pins were a regression) | `tests/latest-async.test.ts`, `tests/createMemo.test.ts` |
| A8 | `isPending(() => latest(x))` tracks the transition the same as `isPending(x)`. | #2829/#2831 | `tests/createMemo.test.ts` |
| A9 | `isPending` on a store leaf behind a firewall reports the firewall's refetch like any async memo. | #2831 finding 1 | `tests/latest-isPending-consistency.test.ts` |
| A10 | `[isPending(x), x()]` read in one scope is atomic: a reader that observed the fresh value must not see `pending === true` for it. | #2831 finding 2 | `tests/latest-isPending-consistency.test.ts` |
| A11 | Sync derivations of transition-held sources are visible through `latest()`/`isPending()` (held sync recompute is a write path like any other). | #2831 finding 3 | `tests/latest-isPending-consistency.test.ts` |
| A12 | A resting optimistic node reports pending only via the async-in-flight check, exactly like a plain async memo (a reverting optimistic write is not a refetch). | #2799, #2806 | `tests/createOptimistic.test.ts` (#2806 cases) |

## Tier B (inferred — needs verdict)

Mark each **keep** or **change**; on *keep* it gets a spec test and moves to
Tier A.

- [ ] **B1 — Resting optimistic ≡ plain node.** A resting optimistic node
  (`_overrideValue === NOT_PENDING`, no active override) is observationally
  identical to a plain signal/memo for *every* read path (`read`, `latest`,
  `isPending`, boundary participation), not just the pending checks A12 covers.
  *Inferred from #2806's "no divergence" language.*
- [ ] **B2 — Companion lanes stay independent.** `isPending`/`latest` companion
  nodes get child lanes that never merge with the owner's lane, so an
  `isPending` effect can flush (show a spinner) while the owner's async is
  still in flight. Merging happens only when the override clears while the
  owner still has pending async. *Inferred from the `assignOrMergeLane`
  parent/child carve-out and `updatePendingSignal`'s late merge.*
- [ ] **B3 — Merged transitions are one unit.** Once two transitions merge,
  every observer sees a single settle point: no effect that depends on
  transition A's writes runs before transition B's async completes. *Inferred
  from `mergeTransitionState` + single `activeTransition` design.*
- [ ] **B4 — Override wins over async correction after user write.** If the
  user writes an optimistic override *after* its lane was created, a later
  async resolution must not clobber the override (`_overrideSinceLane`).
  The fresh value becomes the revert target instead. *Inferred from the
  `_overrideSinceLane` machinery.*
- [ ] **B5 — `isPending` never throws.** `isPending(fn)` returns a boolean for
  any `fn`, including thunks that throw real errors or `NotReadyError`s from
  uninitialized sources (it may *rethrow NotReady in tracked contexts* to keep
  boundary participation — that specific carve-out is B5a and needs its own
  verdict). *Inferred from the catch-all in `isPending`.*

## Tier C (open — needs decision)

- [ ] **C1 — Post-transition in-flight window.** In graphs with no
  render-effect reporters (pure signals), a transition can complete while a
  node's async is still in flight. During that window, should `isPending(x)`
  report `true` (data is refetching) or `false` (no stale view is held)?
  Current behavior: the companion keeps its lane-scoped verdict — `false`
  after revert — while a fresh `computePendingState` would say `true`.
  (Surfaced by narrowing INV-4; see INTERNALS-ASYNC-STATE.md §5a.)
- [ ] **C2 — Subscriber lane loss on revert.** `resolveOptimisticNodes` clears
  subscriber lanes when a reverted value propagates ("reversion" branch of
  `insertSubs`). A subscriber belonging to a different, still-live lane loses
  its lane assignment. Is that intended (reverts trump lanes) or should
  cross-lane subscribers keep their lane?
- [ ] **C3 — Reporter re-registration.** `transitionComplete` prunes reporters
  that no longer block a source. A pruned reporter only re-registers through
  render-effect notification. In pure-signals graphs a memo that re-blocks on
  the same source after pruning never re-registers — is the transition allowed
  to complete "early" there (ties into C1)?

## Process

1. Tier B/C items get a maintainer verdict (issue comment, chat, or edit this
   file).
2. On verdict: write the spec test, cite the verdict date here, move to Tier A.
3. Tier A tests are spec. A PR that changes one must say *why the design
   changed*, not "updated expectations".
