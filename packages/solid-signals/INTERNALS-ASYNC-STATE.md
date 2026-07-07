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

## 5. Invariants for `__TEST__` assertions

Confidence: **high** = implementation self-consistency, assert now.
**medium** = believed structural, assert but watch for false positives.

> Gating: the machinery lives in `core/invariants.ts` behind `__TEST__`, not
> `__DEV__`. The per-write Set tracking and per-flush quiescence sweep cost
> 5-21% across the CodSpeed suite when they ran under `__DEV__` (measured
> 2026-07-06, run for 61722cbe), which would also tax every user's dev build.
> Call sites remain `__DEV__`-guarded for prod tree-shaking; bodies
> early-return unless `__TEST__`. Benchmarks run with `__TEST__: false`
> (see `vite.config.ts` benchmark-mode define).

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

## 5b. Findings from the second assertion pass (2026-07-06, INV-2 + window probes)

- **INV-2 implemented and green.** Active override ⇒ `_pendingValue` revert
  target + registration in a `_optimisticNodes` list, checked at the end of
  every flush. Verified the assertion actually fires via a mutation test
  (deregistering a live override throws INV-2).
- **Blocked-merged window probes** (optimistic node entangled with a second
  async source through a shared reader; own fetch resolved, transition still
  blocked) surfaced two ruled-spec violations (V1: A13 — resting optimistic
  `isPending` false where the plain control is true; V2: A7/A13 — `latest()`
  read-order dependence / `[false, undefined]`) and one new open question
  (C4: ambient reads of an active override see the committed value when
  entangled, the override when not). See SPEC-ASYNC-SEMANTICS.md "Known
  violations" and `tests/spec-async-open-questions.test.ts`.
- **C4 root cause (ruled + fixed same day).** The entangled divergence was a
  premature revert, not a read-path issue: on the first flush after the write,
  `transitionComplete`'s reporter loop found no live blockers (the shared
  reader's dep is the *joined* memo, whose dep walk doesn't reach the sources,
  and it never re-notified because the lane served it the override), and the
  optimistic-node backstop loop excluded nodes pending on **their own** fetch
  (`_error.source !== node`, from 128f5e59). The transition completed and
  `resolveOptimisticNodes` dropped the override one tick after the tracked
  reader saw it. Fix: remove the self-source exclusion — a transition holding
  an optimistic node with an active override and *any* in-flight async
  (its own fetch included) is not complete. Ruled as A17.

## 6. Assumptions / open questions (feed into tier B/C propositions)

- `[RULED 2026-07-07 → A19/V3]` When async is in flight on a node whose
  transition already completed: `isPending` must report `true` — the
  observable value is not final. See decision log and SPEC A19.

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
- `[RULED 2026-07-07 → C2]` A revert may only clear lane assignments that
  resolve to the reverting node's own lane — reverts do not trump other live
  lanes. `insertSubs`'s blanket reversion clear is wrong in principle
  (unobservable today); fix + assertion queued for the #2838 redesign.
- `[RULED 2026-07-07 → C3, closed by A19]` Early transition completion after
  reporter pruning is by design — transitions coordinate rendered commits
  only. Verdict correctness in the leftover window is A19's job (V3).

## 7. Decision log

- 2026-07-07: A20 — overrides are unsettled; pending scope is a property of
  the read. (1) An active override reads `isPending === true` uniformly (every
  node kind): overrides mask stale *content* (A17), not *settlement* — the
  community no-extra-boolean idioms depend on it. Non-derived optimistic
  signals/stores are transaction-scoped values, not predictions (no source can
  confirm them; reversion is certain), so they are pending for the override's
  whole lifetime. (2) An optimistic write pends exactly the leaves it touched
  (known change set); a refetch pends every read of the store (unbounded
  change set) — broadness is what unbounded uncertainty looks like, not a
  store rule. (3) Three-form algebra: `latest` strips *coordination*
  (transition holds, broad firewall inheritance) and nothing strips
  *confirmation* (own async in flight, active override) — so the latest form
  is the "unconfirmed edit?" discriminator on store leaves, and is identical
  to the plain form on standalone self-async nodes (A8): `latest`
  discriminates *whose* unsettledness you read, never *why*. An alternative
  ("override = settled latest view → latest form as pure reload detector")
  was considered and set aside: it makes the unconfirmed-edit question
  inexpressible in any form and breaks the published community idioms, while
  its reload-only question is already answered by scoping reads at
  triggers/sources. NOTE the no-contradiction result that settled the ruling:
  the "optimism guards against pending" pattern (News/Finance) is downstream
  value-shielding — the override stops *invalidation* from cascading, so a
  downstream memo stays clean and its own verdict stays false; pending
  propagates through async status flags, not through cached values, so the
  optimistic node's own `pending === true` never "reads through" a clean
  memo. Both halves are pinned by the News/Finance action tests.
  Latest-form leaf filtering is currently broken (fires during pure refresh,
  then the companion is STUCK true at settle — INV-4 catches the stuck
  state): pinned as V4 for the #2838 redesign.
- 2026-07-07: C2 ruled — reverts do not trump other live lanes; a revert
  releases only members of the reverting node's own lane. Fix + INV-8-style
  assertion ("live lane members are only released by their own lane's
  resolution") queued for the #2838 redesign.
- 2026-07-07: C3 closed by A19 — early transition completion in reporter-less
  graphs is legal; verdicts must not depend on it (V3 pins the symptom).
- 2026-07-07: C1 → A19 — `isPending(x)` ≡ "the observable value of x is not
  final". Three causes with independent lifetimes: (i) transition-held write
  (ends at commit), (ii) own async in flight (ends at resolution), (iii)
  fresh value held uncommitted by an entangled transition (ends at commit).
  Uninitialized async is loading, not pending; its initial NotReady plays to
  boundaries for SSR/hydration (A16). Partially reverses the earlier
  boundary-scoped framing, which was cause (i) wrongly generalized to
  (ii)/(iii). Verdicts must not depend on reporters/graph topology. Causes
  (ii)/(iii) land with the #2838 redesign — pinned as V3/V1 expected
  failures until then.
- 2026-07-07: B4 → A18 — an override's lifetime is bound to its own async
  source, not its transition. Own-source resolution clears/corrects the
  override immediately (fresh value, never the pre-write value); unrelated
  async in a merged transition must not delay the correction or the async it
  triggers. Together with A17: the override holds while its own fetch is in
  flight (transition can't complete and drop it), and yields the moment the
  authoritative value arrives.

- 2026-07-06: C4 → A17 — an active optimistic override is THE value for every
  reader (ambient and tracked), regardless of entanglement, until its owning
  transition completes. `transitionComplete` no longer excludes self-sourced
  pending optimistic nodes from blocking completion.
- 2026-07-07: A17 clarification — no-tearing is enforced at the EFFECT level,
  not the read level. When async derived from the optimistic value is in
  flight, the lane holds its render effects (`runLaneEffects` skips lanes with
  `_pendingAsync`), so the rendered view updates as one unit; but direct reads
  (ambient or in-graph) still return the override immediately. An attempted
  read-level gate (return committed value from ownerless reads while the lane
  holds) broke 19 real-world pinned tests (CategoryDisplay/News-Finance in
  `createOptimistic.test.ts` — "direct read shows optimistic, effect waits")
  and was reverted. Render effects read close to ambient semantics (stale
  reads), so a read-level gate cannot distinguish them cleanly anyway.
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
