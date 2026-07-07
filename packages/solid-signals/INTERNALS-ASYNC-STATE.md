# Async/Transition/Lane State Model — Working Notes

Living document for the pending/transition/optimistic-lane machinery in
`src/core/`. Captures the state model, the invariants we believe hold (with
confidence levels), and the assumptions/decisions made while reviewing. The
companion spec propositions (tier A/B/C) build on this.

Status: **working notes** — updated as understanding is verified. Anything
marked `[assumed]` has been inferred from code, not confirmed by a design
ruling. Anything marked `[ruled]` cites the decision.

## 1. Node state fields

A `Signal`/`Computed` participating in async/transitions carries:

| Field | Meaning | Written by |
| --- | --- | --- |
| `_value` | Committed, visible value | `recompute` (create/effect paths), `commitPendingNode`, `resolveOptimisticNodes`, `asyncWrite` (lane branch) |
| `_pendingValue` | Transition-held next value; `NOT_PENDING` sentinel when absent | `setSignal` (non-optimistic), `recompute` (held branch), `asyncWrite` (override-active branch), `setSignal` on first override (holds the *revert target*) |
| `_overrideValue` | Optimistic override; `undefined` = not an optimistic node, `NOT_PENDING` = resting optimistic node, else = active override | `setSignal` (optimistic branch), `recompute` (lane-corrected), `resolveOptimisticNodes` (clears to `NOT_PENDING`) |
| `_statusFlags` | `STATUS_PENDING` / `STATUS_ERROR` / `STATUS_UNINITIALIZED` | `notifyStatus`, `clearStatus`, commit paths |
| `_error` | Current error (`NotReadyError` for pending, `StatusError`-wrapped for real) | compute catch, `notifyStatus` |
| `_pendingSignal` | Lazily-created companion: boolean "is pending" signal for `isPending()` | `getPendingSignal`, updated via `updatePendingSignal` |
| `_latestValueComputed` | Lazily-created companion: shadow computed for `latest()` | `getLatestValueComputed`, written via `syncCompanions` |
| `_parentSource` | Companion → owner backlink (also store leaf → firewall chains) | companion creation |
| `_optimisticLane` | Lane this node currently belongs to | `assignOrMergeLane`, cleared by `resolveLane` (stale), `resolveOptimisticNodes`, `cleanupCompletedLanes` |
| `_transition` | Transition holding this node's pending state | `initTransition`, `reassignPendingTransition`, cleared by `resolveOptimisticNodes` |
| `_overrideSinceLane` | User wrote to the override after lane creation (async correction must not clobber) | `setSignal` optimistic branch (true), `getOrCreateLane` (false) |

Semantics of the `(_pendingValue, _overrideValue)` pair for an optimistic node:

- `(NOT_PENDING, NOT_PENDING)` — resting optimistic node, behaves like a plain node.
- `(revert target, active value)` — active override; `_pendingValue` holds the value to revert to; the override is what readers see.
- After async resolution with active override: `_pendingValue` holds the *fresh* value (new revert target) — the override stays visible.

## 2. Lanes (`lanes.ts`)

- One lane per optimistic *source signal* (`signalLanes` WeakMap), reused across writes to the same signal. Union-find merging (`_mergedInto`); merges move `_pendingAsync` and effect queues into the root.
- `_parentLane`: companion nodes (`_pendingSignal`/`_latestValueComputed`) get *child* lanes that intentionally do **not** merge with the parent (`assignOrMergeLane` parent/child carve-out) so `isPending` effects can flush before the parent's async settles.
- Lane lifecycle: created on optimistic write → nodes join via `insertSubs(node, true)` → `assignOrMergeLane` → lane-routed effects run when `_pendingAsync` is empty (`runLaneEffects`) → cleaned up by `cleanupCompletedLanes` when the owning transition completes (or when orphaned, `_transition === null`).
- `_pendingAsync` add/delete sites: added in `recompute`'s async catch under a lane (core.ts ~264), removed on async resolution (`asyncWrite`, async.ts ~214) and on lane-corrected recompute (core.ts ~254).

## 3. Transitions (`scheduler.ts`)

- Created by `initTransition` on the first transition-worthy write; at most one `activeTransition` per flush; concurrent ones merge (`mergeTransitionState`, `_done` forwarding pointer).
- `_asyncReporters: Map<source, Set<reporter>>` — which computeds are blocked on which async sources. **Populated only from `GlobalQueue.notify` during render-effect status notification** `[ruled — async-registration-invariants rule]`.
- `_pendingNodes` — nodes whose `_pendingValue` commits when the transition completes (`commitPendingNodes` → `commitPendingNode`).
- `_optimisticNodes` — nodes whose override reverts at completion (`resolveOptimisticNodes`).
- Incomplete-transition flush stashes queues (`stashQueues`) and continues with a fresh view; completion restores them, commits pending, reverts optimistic, replays `_gatedSubs`, cleans lanes.
- `transitionComplete`: prunes dead reporters (`reporterBlocksSource`), transition is done when no live reporter still blocks a pending source and no active-override node is blocked on someone else's async.

## 4. Write paths (all must stay equivalent)

Every path that produces a value for a node must maintain the companions via
`syncCompanions` `[ruled — #2831 fix]`:

1. `setSignal` — direct write (line ~1033).
2. `asyncWrite` — async resolution, four branches: setter / override-active / lane-routed / plain `setSignal` fallback.
3. `recompute` — transition-held sync derivation (line ~334, `activeTransition || el._transition` guard).

Comparator (`_equals`) errors on any of these paths are node errors, routed
through `notifyStatus(STATUS_ERROR)` `[ruled — #2837]`. `setSignal` checks
`STATUS_UNINITIALIZED` *before* invoking the comparator so a user comparator
never sees `undefined` prev on first commit `[decided while fixing #2837]`.

## 5. Invariants for `__DEV__` assertions

Confidence: **high** = implementation self-consistency, assert now.
**medium** = believed structural, assert but watch for false positives.

- **INV-1 (high)** `pendingProbe` is non-null only inside an `isPending()` call
  (it saves/restores; nothing else may write it).
- **INV-2 (high)** A node with an *active* override (`hasActiveOverride`) also has
  `_pendingValue !== NOT_PENDING` (the revert target is set on first override)
  and is registered in a transition's/queue's `_optimisticNodes`.
- **INV-3 (high)** `_asyncReporters` gains entries only inside
  `GlobalQueue.notify` (render-effect notification path). Guard flag around the
  legal write site; assert on any other mutation. `[ruled]`
- **INV-4 (medium)** After any of the three write paths completes for node `el`
  with value `v`: if `el._pendingSignal` exists it reflects
  `computePendingState(el)`, and if `el._latestValueComputed` exists its signal
  value is `v` (companion coherence, #2831).
- **INV-5 (medium)** A lane in `activeLanes` has `_mergedInto === null`
  (merged lanes must be removed or never enumerated as roots) — note:
  `cleanupCompletedLanes` iterates `activeLanes` and checks `_mergedInto`,
  so today merged lanes *do* linger in `activeLanes`; the invariant is that
  they are skipped everywhere. Assert the weaker form: a merged lane's
  `_pendingAsync` and `_effectQueues` are empty (moved on merge).
- **INV-6 (medium)** At the end of a completing-transition flush: every node in
  the completed transition's `_optimisticNodes` has `_overrideValue === NOT_PENDING`
  and `_transition === null`; the transition's lanes are gone from `activeLanes`.
- **INV-7 (medium)** `_pendingValue !== NOT_PENDING` on a non-optimistic node
  implies the node is queued (`_pendingNode`/`_pendingNodes`) or held by a
  transition — a pending value with no committer is a leak (the #2827 class).

Rejected for assertion (state space too dynamic, would need semantic rulings):
whether `_optimisticLane` must always resolve to a live lane (stale lanes are
legal and lazily cleared by `resolveLane`).

## 5a. Findings from the first assertion run (2026-07-06)

Enabling the assertions against the existing green suite immediately produced
two findings — one real defect, one wrong assumption of mine:

- **INV-5 fired 20× — real defect (fixed).** `mergeLanes` *copied* the merged
  lane's `_pendingAsync` and effect queues into the root but never cleared the
  originals. All routing goes through `findLane()` after a merge, so the stale
  copies were dead weight (retained node references — a leak) and made
  "merged lane is empty" unverifiable. Fixed: merge now moves instead of
  copies. This is the only production behavior change from the assertion work.
- **INV-4 as first formulated fired 83× — my assumption was wrong.** I asserted
  that at quiescence a companion `_pendingSignal` must equal a fresh
  `computePendingState(owner)`. False positive: in pure-signals graphs (no
  render effects) transitions complete immediately, so async can still be in
  flight *after* the transition is gone; `computePendingState` then reports
  `true` while the companion (correctly, per lane semantics) still reads
  `false`. The invariant is now scoped to *fully settled* owners (no pending
  status, no held value, no override). What the companion should read in that
  in-between window is a **semantic** question, not a consistency one — see §6.

## 6. Assumptions / open questions (feed into tier B/C propositions)

- `[open — from INV-4 narrowing]` When async is in flight on a node whose
  transition already completed (pure-signals graphs; no render-effect
  reporters), should `isPending` report `true` (data is refetching) or `false`
  (no transition holds a stale view)? Current behavior: the companion keeps its
  last lane-scoped verdict (`false` after revert) while a *fresh*
  `computePendingState` would say `true`.

- `[assumed]` A resting optimistic node (`_overrideValue === NOT_PENDING`) is
  semantically identical to a plain node for every read/pending computation
  (#2799/#2806 lean this way; not stated as a rule).
- `[assumed]` Parent/child lane independence (companion lanes don't merge with
  owner lanes) is a design decision, not an accident — the `assignOrMergeLane`
  carve-out and `updatePendingSignal`'s late merge (when override clears and
  parent still has `_pendingAsync`) encode it.
- `[open]` When two transitions merge, should `isPending` observers of a source
  in transition A report pending for async that only transition B is waiting
  on? (Current behavior: yes, merged transitions are one unit.)
- `[open]` `resolveOptimisticNodes` fires `insertSubs(node, true)` (optimistic
  propagation) when the reverted value differs — but with lane already cleared,
  `insertSubs` takes the "reversion" branch and clears subscriber lanes. Is a
  subscriber that belongs to a *different, still-live* lane allowed to lose its
  lane here?
- `[open]` `transitionComplete` deletes reporters as it prunes — if a reporter
  re-blocks later (new read of the same source), it re-registers via notify.
  Confirmed path? (Only if a render effect re-notifies; a pure memo re-read
  does not.)

## 7. Decision log

- 2026-07-06: #2837 — comparator errors are node errors (boundary-containable);
  `setSignal` checks uninitialized before comparator.
- 2026-07-06: #2839 — `EffectBundle.error` is compute-phase only; effect-phase
  throws escalate to boundary/halt. Compute-phase errors in *user* effects
  without a handler: log + skip run, system stays alive.
- 2026-05..07: #2829/#2831 — `latest()`/`isPending()` fixes; `syncCompanions`
  is the single companion-update chokepoint; `[false, undefined]` test pins
  were a regression, not design.
- #2822 — `ASYNC_OUTSIDE_LOADING_BOUNDARY` is warn-only; the old hard-error
  path was vestigial.
- #2761/#2762 — uncaught errors halt the system loudly (`REACTIVITY_HALTED`);
  recovery belongs to error boundaries.
- #2838 (tracked) — `latest()` shadow should become write-driven post-release;
  the probe-based design is acknowledged overcomplication.
