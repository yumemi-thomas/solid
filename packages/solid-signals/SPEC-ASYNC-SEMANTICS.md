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
| A13 | (was B1) A resting optimistic node (no active override) is observationally identical to a plain async memo for `read`/`latest`/`isPending` at every checkpoint of a refetch cycle — both before any override was written and after a full override cycle reverted. | maintainer keep, 2026-07-06 | `tests/spec-async-semantics.test.ts` |
| A14 | (was B2) `isPending`/`latest` companion nodes get child lanes that do not merge with the owner's lane: an `isPending` effect (spinner) fires while the owner's async is still in flight. | maintainer keep, 2026-07-06 | `tests/spec-async-semantics.test.ts` |
| A15 | (was B3) Transition entanglement is graph-driven: writes whose async work is observed by a shared reader settle as one unit (no tearing — nothing commits until all entangled async resolves); writes on fully disjoint graphs keep independent transitions and settle independently. | maintainer keep, 2026-07-06 | `tests/spec-async-semantics.test.ts` |
| A16 | (was B5) `isPending` never throws in untracked contexts — thunks that throw real errors or read uninitialized async sources yield `false`. Carve-out (B5a, pinned as current behavior): in *tracked* contexts the `NotReadyError` of an uninitialized source propagates so the reader participates in loading boundaries. | maintainer keep, 2026-07-06 | `tests/spec-async-semantics.test.ts` |
| A17 | (was C4) An *active* optimistic override is THE value for every **read** — ambient/untracked and tracked alike — regardless of transition entanglement. "It is the optimistic future value... it is both immediate and is the future until we know otherwise." "Knowing otherwise" is its own async source resolving (see A18); a transition whose optimistic node is still pending on its own fetch is not complete, so the override cannot be dropped early. **No-tearing is an effect-level concern, not a read-level one**: when async *derived from* the optimistic value is in flight, the lane holds its render effects (the rendered view keeps the committed state as a unit) — but direct reads still return the override ("direct read shows optimistic, effect waits"). Do NOT mask the override from any read path to prevent tearing; that breaks the real-world optimistic-UI contract. | maintainer ruling, 2026-07-06/07 | `tests/spec-async-semantics.test.ts`; downstream-async lane holding: `tests/createOptimistic.test.ts` (CategoryDisplay/News-Finance real-world sections) |
| A18 | (was B4; **refined by re-rule 2026-07-07b**) An override's lifetime is bound to **its own transition** — which, because lanes keep their transitions separate from unrelated work, contains exactly the override's own async cascade. Mechanically: authoritative values arriving under an active override hold in `_pendingValue` like any other transition write and **elevate to `_value` only at their transition's commit** (`_value` changes at commit points, period); the elevation is unobservable under the override mask (A17); reverting is a pure drop — there is no revert target and reverts commit nothing. Consequences: (1) in unmerged graphs, own-source resolution IS the lane-transition's completion, so the correction reveals on arrival — the original A18 pins hold unchanged; (2) matching confirmations collapse silently (revert sees value == override, nobody re-runs); (3) when the override's transition genuinely merges with unrelated async, the correction reveals atomically with that merged completion, reading `isPending === true` throughout (A20: overrides are unsettled) — corrections still *propagate* internally on arrival (fresh readers/async drivers see the hold), so downstream refetches start immediately and no waterfalls form; only the reveal is gated. This supersedes the earlier "bound to its own async source, not its transition" formulation, which was implemented by escaping the transition commit (revert-target commit at revert) and allowed a mid-flight arrival to reveal before its own transition completed. | maintainer rulings, 2026-07-07 (original) and 2026-07-07b (re-rule: "the non-blocking aspect… only gates the reveal"; `_value` elevation at commit points) | `tests/spec-async-semantics.test.ts` (same pins — behavior coincides in unmerged graphs) |
| A19 | (was C1 — **partially reverses an earlier decision**) **Definition: `isPending(x)` ≡ the value you can currently observe for `x` is not the final one.** Three causes of non-finality, each ending on its own terms: (i) a write held by a live transition — ends at commit; (ii) the node's own async in flight — ends at resolution; (iii) a fresh value that arrived but is held uncommitted by a transition it's entangled with — ends at that commit. A node is pending while *any* cause holds it and final the moment none does — cascading async falls out of the definition rather than needing a rule ("once it can show its landed value it is no longer pending"). **The one boundary-scoped exception is the initial NotReady**: an uninitialized source is *loading*, not pending (A16/A12) — no observable value exists to be non-final — and its thrown `NotReadyError` must propagate to loading boundaries (A16/B5a) because SSR streaming and hydration reveal are driven by boundaries. Everywhere else, boundaries and reporters never enter the definition: they decide what renders and what a transition waits for, not verdicts. The rejected earlier framing ("if it isn't read somewhere that reports to the transition, it isn't actually pending") was a proxy for cause (i) wrongly applied to causes (ii)/(iii), tying data verdicts to graph-topology accidents. Causes (ii)/(iii) were implemented by the #2838 shadow/companion redesign (2026-07-07) — see V3/V1 under Known violations (fixed). | maintainer ruling, 2026-07-07 | cause (i) + boundary interplay: `tests/spec-async-semantics.test.ts`; causes (ii)/(iii): same file, "V1–V5" describe |
| A20 | **Overrides are unsettled; pending scope is a property of the read; `latest` strips coordination, nothing strips confirmation.** (1) An *active* optimistic override reads `isPending === true` — uniformly, on every node kind (signal, computed, store leaf). Overrides mask stale *content* (A17), not *settlement*: until the node's own source confirms the guess (A18) or the transition reverts it, the shown value is unconfirmed. `isPending` reports unsettledness, never what UI to show — the community no-extra-boolean idioms (`isPending(() => books.length)` as the "Adding…" label) depend on this. Non-derived optimistic signals/stores are the degenerate case: no source can ever confirm them (they are transaction-scoped values, not predictions), so reversion is certain and they are pending for the override's whole lifetime. (2) Scope: `isPending(fn)` reports unsettledness of what `fn` *touched*. A refetch pends every read of a store because the authority's change set is unbounded; an optimistic write pends exactly the leaves it wrote (known change set) — untouched siblings stay settled. Broadness is not a store rule, it is what unbounded uncertainty looks like. (3) The three forms: a transition hold and broad firewall inheritance are *coordination* (future value known; the wait is atomicity) — the `latest` view absorbs them. A node's own async in flight and an active override are *confirmation-uncertainty* (future value unknown) — pending under **both** plain and latest forms (consistent with A8 for self-async memos). Pairing rule: render `x()` → `isPending(x)`; render the optimistic visual `latest(x)` → `isPending(() => latest(x))`. `latest` discriminates *whose* unsettledness you read, never *why*: on store leaves it filters inherited firewall breadth (the "refresh-noise" idiom); on standalone self-async nodes it is identical to the plain form (A8) — a node's refresh and its confirmation are the same event, so the edit-vs-reload question needs granularity (a store leaf) or a separate transaction-scoped flag. (4) No contradiction with "optimism guards against pending" (News/Finance): the guard is downstream value-shielding — the override stops invalidation from cascading, so a downstream memo stays clean and its own verdict stays `false`; pending propagates through async status, not cached values, so the optimistic node's own `true` never reads through a clean memo. | maintainer ruling, 2026-07-07 (this supersedes the earlier "override assumes not pending" framing — that instinct is honored on the *value* axis by A17, not the settlement axis) | `tests/spec-async-semantics.test.ts`; downstream shielding: `tests/createOptimistic.test.ts` (News/Finance action pattern); latest-form leaf filter: **V4** in the "V1–V5" describe (fixed 2026-07-07) |

## Tier B (inferred — needs verdict)

Mark each **keep** or **change**; on *keep* it gets a spec test and moves to
Tier A.

- [x] **B4 — RULED, promoted to A18 (2026-07-07).** The original inferred
  statement ("async resolution must not clobber a user override") was
  rejected: overrides clear when **their own async source** resolves. The
  `_overrideSinceLane` machinery only prevents a *stale* in-flight resolution
  (initiated before the user's write) from clobbering mid-lane; it does not
  extend the override past its source's fresh resolution.

## Tier C (open — needs decision)

- [x] **C1 — RULED, promoted to A19 (2026-07-07).** `isPending` is about
  data, not boundaries: `true` during any in-flight refetch with a stale
  visible value, even after the transition completed. Reverses the earlier
  boundary-semantics decision. Implementation deferred to the #2838 redesign
  (pinned as expected failure V3).
- [x] **C2 — RULED (2026-07-07): reverts do not trump other live lanes.** A
  reverting node's committed value is fresh authoritative input to any other
  lane's view (A18); releasing a cross-lane subscriber from its live lane
  would tear that lane's atomic reveal. A revert may only clear lane
  assignments that resolve to the reverting node's own (dead) lane. The
  blanket clear in `insertSubs`'s reversion branch violates this in
  principle; no observable divergence is constructible today (convergence
  merges lanes; companion child-lanes behaved in all probes), so the fix and
  a "live lane members are only released by their own lane's resolution"
  assertion are queued for the #2838 redesign rather than patched now.
- [x] **C3 — CLOSED by A19 (2026-07-07): early completion is by design.**
  Transitions coordinate rendered commits; in graphs with no render-effect
  reporters there is nothing to coordinate, so a transition completing after
  reporter pruning (even with async still in flight) is legal. The harm it
  used to cause — wrong `isPending`/`latest` verdicts in the window — is
  A19's responsibility (verdicts derive from data state, never reporter
  topology) and is pinned as V3.
- [x] **C4 — RULED, promoted to A17 (2026-07-06).** The override must always
  be read if present. The observed divergence was not a visibility question
  but a premature-revert bug: `transitionComplete` excluded a node pending on
  *its own* fetch from blocking completion (`_error.source !== node`), so an
  entangled (merged) transition completed on the first flush and silently
  dropped the override. Fixed by removing the self-source exclusion.

## Known violations — ALL FIXED by the #2838 redesign (2026-07-07)

Four ruled Tier A propositions were violated, mostly in the **blocked-merged
window** (a node's own fetch resolved, but a shared reader entangles it with
another still-pending async source, so nothing commits). All four now pass
and are pinned as spec tests in `tests/spec-async-semantics.test.ts`
("V1–V5" describe); the former `it.fails` characterization file
(`spec-async-open-questions.test.ts`) is retired. What each was, and what
fixed it:

- **V1 (violated A13) — FIXED.** A *resting* optimistic node reported
  `isPending === false` in the window while still showing the stale value.
  Root cause: `computePendingState`'s #2799 carve-out skipped the held
  `_pendingValue` for every resting optimistic node. The INV-8 provenance
  probe proved a resting node can never hold a *revert target*, so the
  carve-out was removed outright: a held value on a resting node is always a
  refetch/transition hold and reads pending, like a plain memo. (Revert
  targets were later eliminated entirely — 2026-07-07b, see V5 — so today
  *every* held value on *any* node is a pending commit.) `asyncWrite`'s
  resting-hold branch also now syncs companions like every other write path.
- **V2 (violated A7/A13) — FIXED.** `latest()`'s verdict in the window was
  *read-order dependent*: an early probe froze the shadow at the stale value
  for the entire window. Fixed by the same resting-hold companion sync (the
  arriving value is pushed into the shadow) plus the settlement checkpoint
  (`snapCompanionsToState`): commits/reverts invalidate a shadow whose
  cached value diverged from committed state, so it re-derives on next pull.
- **V3 (violated A19) — FIXED.** After a reporter-less transition completed,
  an existing companion kept its transition-scoped `false` while the refetch
  was still in flight. Fixed by the settlement checkpoint: when
  `resolveOptimisticNodes`/`commitPendingNode` settle a node (or its
  companion), the companion re-derives from `computePendingState` and the
  verdict is written *committed* — verdicts are a property of the data (A19)
  and survive the transition that produced them.
- **V4 (violated A20's three-form algebra) — FIXED.** The latest-form on an
  optimistic store leaf with no unconfirmed edit now filters a pure firewall
  refresh (`computePendingState` strips broad firewall inheritance for
  resting optimistic-capable leaves — plain store leaves keep A9, standalone
  self-async nodes keep A8), and the stuck-true companion is gone: a
  firewall's status change pokes the companions of its probed leaves
  (`updateChildCompanions`).

- **V5 (A17 corollary — found and fixed with the revert-target elimination,
  2026-07-07b).** A first optimistic write in the blocked-merged window
  clobbered the held refetch value (`_pendingValue = _value` stashed the
  stale committed value over it), so the eventual revert resurrected stale
  data. Fixed structurally: revert targets no longer exist — masked
  authoritative arrivals hold in `_pendingValue` like any other transition
  write and elevate at their own transition's commit, unobservably under the
  override (A17); revert is a pure drop. Pinned in the "V1–V5" describe
  alongside its siblings.

The companion-vs-oracle census (`COMPANION_CENSUS=1`) reports **zero
divergence fingerprints** across the suite post-redesign.

## Process

1. Tier B/C items get a maintainer verdict (issue comment, chat, or edit this
   file).
2. On verdict: write the spec test, cite the verdict date here, move to Tier A.
3. Tier A tests are spec. A PR that changes one must say *why the design
   changed*, not "updated expectations".
