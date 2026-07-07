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
| `_pendingValue` | Transition-held next value; `NOT_PENDING` sentinel when absent (one meaning — a pending commit; revert targets were eliminated 2026-07-07b, §5e) | `setSignal` (non-optimistic), `recompute` (held branch), `asyncWrite` (override-active branch) |
| `_overrideValue` | Optimistic override; `undefined` = not an optimistic node, `NOT_PENDING` = resting optimistic node, else = active override | `setSignal` (optimistic branch), `recompute` (lane-corrected), `resolveOptimisticNodes` (clears to `NOT_PENDING`) |
| `_optimisticMask` | Store-wide mask counter on a derived store's firewall: number of store targets under it with live optimistic state; non-zero forces every verdict under the firewall to `false` (A21) | `maskStoreTarget` (store.ts) — incremented from `prepareStoreWrite`/`deleteProperty` on the first optimistic write to a target, decremented from `clearOptimisticStore`/`clearOptimisticOverride` |
| `_statusFlags` | `STATUS_PENDING` / `STATUS_ERROR` / `STATUS_UNINITIALIZED` | `notifyStatus`, `clearStatus`, commit paths |
| `_error` | Current error (`NotReadyError` for pending, `StatusError`-wrapped for real) | compute catch, `notifyStatus` |
| `_pendingSignal` | Lazily-created companion: boolean "is pending" signal for `isPending()` | `getPendingSignal`, updated via `updatePendingSignal` |
| `_latestValueComputed` | Lazily-created companion: shadow computed for `latest()` | `getLatestValueComputed`, written via `syncCompanions` |
| `_parentSource` | Companion → owner backlink (also store leaf → firewall chains) | companion creation |
| `_optimisticLane` | Lane this node currently belongs to | `assignOrMergeLane`, cleared by `resolveLane` (stale), `resolveOptimisticNodes`, `cleanupCompletedLanes` |
| `_transition` | Transition holding this node's pending state | `initTransition`, `reassignPendingTransition`, cleared by `resolveOptimisticNodes` |

Semantics of the `(_pendingValue, _overrideValue)` pair for an optimistic node
(see §5e — revert targets were eliminated 2026-07-07):

- `(NOT_PENDING, NOT_PENDING)` — resting optimistic node, behaves like a plain node.
- `(NOT_PENDING, active value)` — active override; readers see the override, `_value` is untouched.
- `(held value, active value)` — fresh authoritative value arrived under the mask; it holds in
  `_pendingValue` and elevates to `_value` on its own transition's commit. Reverting is a pure
  drop of the override — `_value` is already correct.

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
- **INV-2 (high)** A node with an *active* override (`hasActiveOverride`) is
  registered in a transition's/queue's `_optimisticNodes`. (The original
  revert-target half was retired with §5e — there is no revert target to
  assert.)
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
- **INV-9 (high)** An `isPending` companion of a DISPOSED owner reads `false`
  at quiescence — a stale `true` outliving its source would hold a spinner
  forever (the #2845 disposal edge). Enforced by the disposal guard in
  `computePendingState` plus the `snapCompanionsToState` call in
  `disposeChildren`.
- **INV-10 (high)** The mask (A20/A21, 2026-07-07c): a companion's
  *observable* verdict (override first, A17) is `false` whenever its owner
  holds an active override, and whenever its firewall's `_optimisticMask` is
  non-zero — checked for every node in `_optimisticNodes` and every tracked
  companion owner at the end of each flush.

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
  violations" (all fixed 2026-07-07; pinned in
  `tests/spec-async-semantics.test.ts`, "V1–V5" describe).
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

## 5c. Companion-vs-oracle census (2026-07-07, #2838 pre-work)

A non-asserting diff logger (`devCensusCompanions`, enabled via the
`COMPANION_CENSUS` env var) compared every live companion against a fresh
oracle at the end of every flush across the whole suite. Nine distinct
divergence fingerprints; the taxonomy:

**Pending companions (6 fingerprints, ~most-hit first):**

| owner state at flush end | companion | oracle |
| --- | --- | --- |
| plain node, own async in flight (`sp=1`) | false | true |
| ACTIVE override, revert target held | false | true |
| plain node, transition-held `_pendingValue` | false | true |
| store leaf (uninit) behind refetching firewall | false | true |
| resting optimistic, refetch in flight | false | true |
| active override + own fetch in flight | false | true |

**Latest shadows (3 fingerprints, all on settled-or-override owners):**

- shadow holds a stale previous value while the owner is fully settled;
- shadow reads `undefined` while the owner has a committed value (the V2
  `[false, undefined]` family);
- shadow reads `undefined` while an override is ACTIVE (A17 violation via
  `latest()`: the shadow never mirrored the override).

**The headline finding: every pending divergence is one-directional.**
Companions only ever *under-report* (`false` when the oracle says `true`) —
no fingerprint showed a companion stuck `true` against a `false` oracle at a
flush boundary (the V4 stuck-true case exists but arises past settle, caught
by INV-4). The probe-driven design misses *activations*: nothing refreshes a
companion when (1) status flags change (async starts), (2) an override is
written, (3) a `_pendingValue` hold is written. Shadows additionally
initialize to `undefined` and never mirror overrides.

**Redesign requirement derived from the census:** the write-driven companion
must be updated at exactly four transition points — status-flag transitions
(notifyStatus/clearStatus), override set/clear, pendingValue hold/commit,
and (for shadows) initialization from the committed value + override
mirroring. Those four cover all nine fingerprints plus V1–V4.

## 5d. The redesign as landed (2026-07-07, closes #2838's core)

Companions stayed lazy and probe-created; what changed is that every oracle
input now flows through to them, and settlement re-derives them:

1. **Oracle simplification (V1).** The #2799 resting-optimistic carve-out in
   `computePendingState` was removed. INV-8 provenance proved a resting node
   can never hold a revert target (revert targets only coexist with an ACTIVE
   override; the revert commits the value), so a held value on a resting node
   is always a refetch/transition hold — pending, like a plain memo.
2. **Missing write path (V1/V2).** `asyncWrite`'s resting-hold branch now
   calls `syncCompanions` like every other write: the arriving value updates
   the verdict and is pushed into the `latest()` shadow (no more read-order
   freeze).
3. **Settlement checkpoint (V3).** `snapCompanionsToState(owner)`: called
   from `commitPendingNode` and `resolveOptimisticNodes` (second pass over
   the settled batch — the batch is spliced, not cleared, because snaps can
   push fresh optimistic nodes). It re-derives the companion from
   `computePendingState` and writes the verdict COMMITTED (not via
   `setSignal` — an override window opened at settlement would itself need a
   settlement, re-scheduling forever while async is in flight). A companion
   with an active override is skipped: its own revert re-enters the snap.
   Shadows whose cached value diverged from committed state are invalidated
   (dirty + heap + notify) so the next pull re-derives; coherent shadows are
   left alone (dirtying them re-ran effects with half-settled state).
   `_pendingSignal._parentSource` is now always the owner (was: only for
   store-leaf chains) so the checkpoint can find the owner from a reverted
   companion.
4. **Status pokes flow to the whole companion tree (V3/V4).**
   `updatePendingSignal(el)` recurses into `el._latestValueComputed` (the
   shadow's verdict derives from the owner), and `notifyStatus`/`clearStatus`
   on a firewall call `updateChildCompanions` — probed leaves re-derive when
   the firewall's async starts/settles (no more stuck-true leaf companions).
5. **A20 latest-form filter (V4).** ~~`computePendingState`'s `_parentSource`
   branch strips broad firewall inheritance for optimistic-capable leaves
   with no unconfirmed edit.~~ **Superseded by the mask model (§5f)** — the
   filter belonged to the one-day "overrides are unsettled" A20 and was
   replaced by the per-channel verdict + mask checks. The companion-poke
   plumbing from this item (point 4 above) is what survives.

Post-redesign census: **zero divergence fingerprints** across the suite
(the census itself was refined to compare the companion's *visible* value —
override first, A17 — and to ignore one-flush holds already queued for
commit, where the A10 pair rule makes the disagreement unobservable).
Cost: +253 B gzip on `dist/prod.js` (+1.0%); core reactivity benchmarks
unchanged within noise. C2's `insertSubs` blanket lane-clear on reversion
remains queued (still unobservable; needs dead-lane plumbing).

## 5e. Revert-target elimination (2026-07-07b — A18 re-rule)

The `_pendingValue` slot used to mean three things: a plain write awaiting
flush commit, a transition-held value awaiting transition commit, and the
*revert target* for an active override (refreshed from four write sites,
committed by `resolveOptimisticNodes` at revert). The third meaning is gone.
The invariant set is now:

- **`_pendingValue` has one meaning: a pending commit.** Every held value
  elevates to `_value` at its own transition's commit (or the plain flush
  commit), through `queuePendingNode`/`commitPendingNode` — no exceptions.
- **`_value` changes only at commit points.** Under an active override the
  hold and its eventual commit are unobservable (A17: every reader gets the
  override; the one raw-`_value` reader — the stashed-read exception — only
  admits plain optimistic signals, which have no authoritative writer).
- **Revert is a pure drop.** `resolveOptimisticNodes` clears the override,
  compares it against `_value`, notifies on divergence — commits nothing.
  Masked holds queue into their transition (`recompute`'s queue gate allows
  override-active nodes through; `asyncWrite`'s override branch collapsed
  into the resting branch), so nothing leaks (INV-7) and nothing reveals
  before its transition completes.
- Masked holds do **not** notify subscribers (`asyncWrite` skips
  `insertSubs` under an active override): the visible value is unchanged;
  the revert is the notification point.

This fixed a real clobber bug (**V5**, pinned in the spec suite): the old
first-override stash (`_pendingValue = _value`) overwrote a refetch value
held on a resting node in the blocked-merged window, so the revert
resurrected stale data. INV-2 no longer asserts a revert target; the INV-8
hold-provenance tracker was deleted (one meaning — nothing to distinguish).

An intermediate design ("silent commit": masked arrivals write `_value`
directly, elevation immediate) was implemented and discarded — it kept the
old reveal-at-revert timing but gave `_value` a context-dependent meaning.
The commit-point discipline (maintainer re-rule of A18) reveals corrections
atomically with their own (possibly merged) transition — reading
`isPending === false` throughout under the A20 mask (2026-07-07c);
corrections still *propagate* internally on arrival, so downstream refetches
start immediately — the schedule only gates the reveal.

## 5f. The mask model (2026-07-07c — A20/A21 re-rule, #2844/#2728)

The verdict oracle was rewritten around one rule: **an active override is
certainty by decree, and `isPending` follows the channel the read observes.**
`computePendingState` is now a short decision ladder:

1. **Disposal guard** — `REACTIVE_DISPOSED` → `false` (INV-9; a dead source
   can never settle).
2. **Store-wide mask** — `(firewall || node)._optimisticMask` → `false`
   (A21; the store is the primitive the decree covers).
3. **Latest-shadow branch** (`_parentSource` set): the fresh channel.
   Owner has an active override → `false` (the decree); owner's firewall
   masked → `false`; otherwise pending iff the owner (or its firewall) has
   `STATUS_PENDING` without `STATUS_UNINITIALIZED` — in-flight async only,
   **no held-value checks**: the shadow already shows held values, so a hold
   cannot supersede what it shows (A8: "false as soon as that async is done,
   even if the same update has other async still running").
4. **Own active override** → `false` (A20 node-scoped mask).
5. **Held store leaf defers to its firewall** — while the firewall's own
   work is in flight the firewall carries the verdict (probes collect both);
   the leaf reports only holds the firewall does not explain (manual
   projection writes; holds outliving a settled firewall). Prevents
   duplicate leaf/firewall effect churn during projection loads.
6. **Held value** (`_pendingValue`, initialized) → `true` (plain channel:
   a pending commit supersedes the committed value — A19 causes i/iii).
7. **Own async in flight** (initialized) → `true` (A19 cause ii).

Supporting machinery:

- **`maskStoreTarget(target, on)`** (store.ts): flips `STORE_MASKED` on the
  store target and maintains the firewall's `_optimisticMask` counter;
  on 0↔1 transitions pokes the firewall's companion and every probed leaf's
  (`updatePendingSignal` + `updateChildCompanions`). Raised from
  `prepareStoreWrite`/`deleteProperty` on the first optimistic write to a
  target; lowered from `clearOptimisticStore`/`clearOptimisticOverride`
  when the target's optimistic state fully clears. Plain stores without a
  firewall never set the flag.
- **Disposal snap** (owner.ts): `disposeChildren` calls
  `snapCompanionsToState` on disposed owners that have companions, so a
  latched `true` verdict reverts and notifies instead of outliving its
  source (INV-9).
- **INV-10** (invariants.ts): end-of-flush assertion of the mask, both arms
  (active-override owners and store-wide-masked firewalls/leaves), using the
  companion's *observable* verdict (override first, A17).

Dead machinery removed with the model (verified by suite + census):

- `updatePendingSignal`'s late lane-merge block (merging a companion's
  sub-lane into the source's lane when an override cleared) — with masked
  verdicts there is no `true`→`false` edge at override-clear to coordinate;
  `mergeLanes`/`signalLanes` imports left with it.
- `read()`'s probe special-case that forced `pendingProbe.found = true` for
  firewall/override hits — verdicts now come uniformly from
  `computePendingState` over collected sources.

Cost: net −27 B raw / +8 B gzip on minified `dist/prod.js`; core reactivity
and store benchmarks flat within noise (best-of-3 isolated runs).

## 6. Assumptions / open questions (feed into tier B/C propositions)

- `[RULED 2026-07-07 → A19/V3]` When async is in flight on a node whose
  transition already completed: `isPending` must report `true` — the
  observable value is not final. See decision log and SPEC A19.

- `[assumed]` A resting optimistic node (`_overrideValue === NOT_PENDING`) is
  semantically identical to a plain node for every read/pending computation
  (#2799/#2806 lean this way; not stated as a rule).
- `[assumed]` Parent/child lane independence (companion lanes don't merge with
  owner lanes) is a design decision, not an accident — the `assignOrMergeLane`
  carve-out encodes it. (The other encoder, `updatePendingSignal`'s late
  merge at override-clear, was removed as dead under the mask model — §5f.)
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

- 2026-07-07c: **A20 re-ruled — the mask** (supersedes the previous day's
  "overrides are unsettled" entry below; GabbeV model adopted after the
  #2844/#2728 discussions and the todos-example precedent). An active
  override reads `isPending === false` for its whole lifetime, on every node
  kind, in both forms — action affordances belong in the data (co-written
  flags / separate `createOptimistic(false)`), never in verdicts. **A21**
  added: for derived optimistic stores the mask is store-wide (any live
  optimistic write silences the whole store — "the store is the boundary";
  writes to the same store entangle). **A8** re-ruled: `latest` is an
  override the system writes for itself as soon as a held value exists, so
  the latest form follows the source's own async only (never pending on
  signals/sync computeds; false the instant the fetch resolves even if the
  commit is held by merged async). **A9** re-ruled: both forms report a
  firewall refetch on resting leaves (old latest-form filter gone; A21 is
  the only silencer). Implementation in §5f; INV-10 enforces; the
  repo agent rules (`.cursor/rules/async-registration-invariants.mdc`) carry
  the mask rules so future changes can't regress them silently.
- 2026-07-07c: disposal latch fixed (INV-9, the #2845 edge):
  `computePendingState` returns `false` for disposed nodes and
  `disposeChildren` snaps companions, so no verdict outlives its source.
- 2026-07-07: #2838 core redesign landed — V1–V4 fixed (see §5d). The
  carve-out removal reverses the #2799 *mechanism* while preserving its
  intent (the original #2799 symptom — pending muted during refresh — is
  covered by the A13 spec tests; the fix's over-broad skip was V1's cause).
- 2026-07-07: considered and REJECTED — mode-conditional NotReady from
  `isPending` (throw only during SSR/hydration, return a value in CSR).
  Rationale for rejection: (1) the tracked-uninitialized read is the ONLY
  throwing case — everything post-initialization is already safe outside
  boundaries in every mode, so the proposal only legalizes hand-rolled
  initial-load boundaries (`isPending(data) ? spinner : data()`); (2)
  boundaries are structural (SSR streaming and hydration reveal need
  delimited regions), verdicts are informational — a safe-everywhere client
  primitive becomes the easiest way to write loading UI that SSR cannot
  stream, creating a CSR→SSR migration cliff in code authors consider
  finished; (3) it forks a primitive's semantics by execution mode right
  after V1–V3 established that verdicts must not depend on context
  accidents; (4) the one-rule model "isPending performs the read you give
  it" (the probe is not a shield) stays true in every environment today.
  Keep A16/B5a as ruled.
- 2026-07-07: A20 — overrides are unsettled; pending scope is a property of
  the read. **(SUPERSEDED next day by the 2026-07-07c mask re-rule above;
  kept for the reasoning record.)** (1) An active override reads `isPending === true` uniformly (every
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
  authoritative value arrives. **(Superseded by the 2026-07-07b re-rule
  below.)**
- 2026-07-07b: A18 re-ruled during the revert-target elimination (§5e) —
  an override's lifetime is bound to **its own transition**, and `_value`
  changes only at commit points. In unmerged graphs own-source resolution IS
  the lane-transition's completion, so behavior coincides with the original
  ruling (all original A18 pins unchanged). In genuinely merged transitions,
  corrections reveal atomically with the merged completion — pending true
  throughout (A20) — instead of escaping early via the revert-commit. The
  "unrelated async must not delay" concern was re-examined: matching
  confirmations collapse silently either way; corrections propagate
  internally on arrival (no waterfalls); only the reveal is gated, honestly
  dimmed. Maintainer: "the non-blocking aspect… this only gates the reveal";
  "`_value` elevation should only happen at the end of the transition."

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
