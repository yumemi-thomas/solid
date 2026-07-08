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
| A8 | (**re-ruled 2026-07-07c** — was "tracks the transition the same as `isPending(x)`") **`isPending(() => latest(x))` follows `x`'s own async only — verdicts are per-channel.** `latest` is an override the system writes for itself the moment a held value exists ("it is like an optimistic that sets itself to the value as soon as it is available to do so"), and that self-override masks like any other (A20). So the latest form reads `true` only while `x`'s own fetch is in flight (showing the stale value) and turns `false` the instant that fetch resolves — even if the same update has other async still running and the commit is held. On a signal or sync computed the held value exists from the instant of the write, so their latest form is *never* pending. The plain form keeps watching the committed channel (holds included). Pairing falls out: `[isPending(() => latest(x)), latest(x)]` never pairs `true` with the fresh value. | GabbeV/maintainer re-rule, 2026-07-07c | `tests/createMemo.test.ts`, solid-web `test/latest-async.spec.tsx` |
| A9 | `isPending` on a store leaf behind a firewall reports the firewall's refetch like any async memo — in **both** forms (the latest-form filter of the old A20 is gone; an in-flight refetch supersedes both channels). Exception: the store-wide mask (A21) silences it. | #2831 finding 1; both-forms + mask exception re-ruled 2026-07-07c | `tests/latest-isPending-consistency.test.ts`, V4 pin in `tests/spec-async-semantics.test.ts` |
| A10 | `[isPending(x), x()]` read in one scope is atomic: a reader that observed the fresh value must not see `pending === true` for it. | #2831 finding 2 | `tests/latest-isPending-consistency.test.ts` |
| A11 | Sync derivations of transition-held sources are visible through `latest()`/`isPending()` (held sync recompute is a write path like any other). | #2831 finding 3 | `tests/latest-isPending-consistency.test.ts` |
| A12 | A resting optimistic node reports pending via exactly the causes a plain async memo does (A19) — a reverting optimistic write is not among them (a revert is not a refetch). (Phrasing updated with V1: "only the async-in-flight check" predated held-value pends, which resting nodes now report like any memo.) | #2799, #2806 | `tests/createOptimistic.test.ts` (#2806 cases) |
| A13 | (was B1) A resting optimistic node (no active override) is observationally identical to a plain async memo for `read`/`latest`/`isPending` at every checkpoint of a refetch cycle — both before any override was written and after a full override cycle reverted. | maintainer keep, 2026-07-06 | `tests/spec-async-semantics.test.ts` |
| A14 | (was B2) `isPending`/`latest` companion nodes get child lanes that do not merge with the owner's lane: an `isPending` effect (spinner) fires while the owner's async is still in flight. (Re-scoped 2026-07-07c: the pin drives the spinner with a plain refetch — an optimistic write no longer produces a `true` verdict at all, per the A20 mask.) | maintainer keep, 2026-07-06; re-scoped 2026-07-07c | `tests/spec-async-semantics.test.ts` |
| A15 | (was B3) Transition entanglement is graph-driven: writes whose async work is observed by a shared reader settle as one unit (no tearing — nothing commits until all entangled async resolves); writes on fully disjoint graphs keep independent transitions and settle independently. | maintainer keep, 2026-07-06 | `tests/spec-async-semantics.test.ts` |
| A16 | (was B5) `isPending` never throws in untracked contexts — thunks that throw real errors or read uninitialized async sources yield `false`. Carve-out (B5a, pinned as current behavior): in *tracked* contexts the `NotReadyError` of an uninitialized source propagates so the reader participates in loading boundaries. | maintainer keep, 2026-07-06 | `tests/spec-async-semantics.test.ts` |
| A17 | (was C4) An *active* optimistic override is THE value for every **read** — ambient/untracked and tracked alike — regardless of transition entanglement. "It is the optimistic future value... it is both immediate and is the future until we know otherwise." "Knowing otherwise" is its own async source resolving (see A18); a transition whose optimistic node is still pending on its own fetch is not complete, so the override cannot be dropped early. **No-tearing is an effect-level concern, not a read-level one**: when async *derived from* the optimistic value is in flight, the lane holds its render effects (the rendered view keeps the committed state as a unit) — but direct reads still return the override ("direct read shows optimistic, effect waits"). Do NOT mask the override from any read path to prevent tearing; that breaks the real-world optimistic-UI contract. | maintainer ruling, 2026-07-06/07 | `tests/spec-async-semantics.test.ts`; downstream-async lane holding: `tests/createOptimistic.test.ts` (CategoryDisplay/News-Finance real-world sections) |
| A18 | (was B4; **refined by re-rule 2026-07-07b**) An override's lifetime is bound to **its own transition** — which, because lanes keep their transitions separate from unrelated work, contains exactly the override's own async cascade. Mechanically: authoritative values arriving under an active override hold in `_pendingValue` like any other transition write and **elevate to `_value` only at their transition's commit** (`_value` changes at commit points, period); the elevation is unobservable under the override mask (A17); reverting is a pure drop — there is no revert target and reverts commit nothing. Consequences: (1) in unmerged graphs, own-source resolution IS the lane-transition's completion, so the correction reveals on arrival — the original A18 pins hold unchanged; (2) matching confirmations collapse silently (revert sees value == override, nobody re-runs); (3) when the override's transition genuinely merges with unrelated async, the correction reveals atomically with that merged completion — reading `isPending === false` throughout (A20 mask: the override is decreed settled) — corrections still *propagate* internally on arrival (fresh readers/async drivers see the hold), so downstream refetches start immediately and no waterfalls form; only the reveal is gated. This supersedes the earlier "bound to its own async source, not its transition" formulation, which was implemented by escaping the transition commit (revert-target commit at revert) and allowed a mid-flight arrival to reveal before its own transition completed. | maintainer rulings, 2026-07-07 (original) and 2026-07-07b (re-rule: "the non-blocking aspect… only gates the reveal"; `_value` elevation at commit points) | `tests/spec-async-semantics.test.ts` (same pins — behavior coincides in unmerged graphs) |
| A19 | (was C1 — **partially reverses an earlier decision**) **Definition: `isPending(x)` ≡ the value you can currently observe for `x` is not the final one.** Three causes of non-finality, each ending on its own terms: (i) a write held by a live transition — ends at commit; (ii) the node's own async in flight — ends at resolution; (iii) a fresh value that arrived but is held uncommitted by a transition it's entangled with — ends at that commit. A node is pending while *any* cause holds it and final the moment none does — cascading async falls out of the definition rather than needing a rule ("once it can show its landed value it is no longer pending"). **Two exceptions.** (1) The initial NotReady: an uninitialized source is *loading*, not pending (A16/A12) — no observable value exists to be non-final — and its thrown `NotReadyError` must propagate to loading boundaries (A16/B5a) because SSR streaming and hydration reveal are driven by boundaries. (2) Decree (amended 2026-07-07c): an active optimistic override is final *because its writer declared it so* — the A20 mask exempts the node (and, for derived stores, the whole store — A21) from every cause above for the override's lifetime. "Not the final one" is judged per channel read (A20 §2), and an override supersedes both channels. Everywhere else, boundaries and reporters never enter the definition: they decide what renders and what a transition waits for, not verdicts. The rejected earlier framing ("if it isn't read somewhere that reports to the transition, it isn't actually pending") was a proxy for cause (i) wrongly applied to causes (ii)/(iii), tying data verdicts to graph-topology accidents. Causes (ii)/(iii) were implemented by the #2838 shadow/companion redesign (2026-07-07) — see V3/V1 under Known violations (fixed). | maintainer ruling, 2026-07-07 | cause (i) + boundary interplay: `tests/spec-async-semantics.test.ts`; causes (ii)/(iii): same file, "V1–V5" describe |
| A20 | (**re-ruled 2026-07-07c** — supersedes the 2026-07-07 "overrides are unsettled" ruling, which held for one day) **The mask: an optimistic override is certainty by decree; `isPending` follows the channel you read.** (1) An *active* override reads `isPending === false` — uniformly, on every node kind, in **both** forms, for the override's whole lifetime (until its own source confirms it, A18, or the transition reverts it). Writing optimistically *declares* the shown value the outcome; a decree cannot be superseded by work already in motion, because the writer just asserted it won't be. `isPending` is reserved for data being updated by machinery the reader did *not* decree — refetches, transition-held commits — never for the provisional nature of an override ("isPending is about the data being in the process of being updated, not about an action being in progress"). Action-scoped affordances ("Saving…", per-row spinners) therefore belong **in the data**: a co-written flag (`todo.pending = true` — the repo's todos example) or a separate `createOptimistic(false)`. You are already writing the optimistic update; the flag rides along. The old no-extra-boolean idiom (`isPending(() => books.length)` as the "Adding…" label) is rejected — it derived an action's progress from a data verdict. (2) Verdicts are per-channel: the plain form watches the *committed* channel — pending while its own fetch is in flight and while a resolved value is held uncommitted by a transition; the latest form watches the *fresh* channel — `latest` is an override the system writes for itself the moment a held value exists (A8), and that self-override masks holds like any user override, leaving only actually-in-flight async as its pending cause. Pairing falls out for both forms: neither ever pairs `true` with the value that made it false. (3) Scope: the mask covers the primitive that was written — node-scoped for signals and computeds; store-scoped for derived optimistic stores (A21). (4) Non-derived optimistic signals/stores are never pending *from themselves* — there is no source to confirm or refetch, the write is an instantly-visible decree — they pend only via a transition hold on the trigger like any plain signal. (5) No tension with A17/A18: the override is THE value (A17), its lifetime is transition-bound (A18), and the mask simply says the verdict agrees with the decree for exactly that lifetime — mask on at write, off at revert/confirm, in the same atomic settle. | GabbeV model adopted, maintainer re-rule 2026-07-07c (#2844/#2728 discussions) | A20 describe in `tests/spec-async-semantics.test.ts`; `tests/createOptimistic.test.ts` (mask + source-still-pends contrast); latest-channel: `tests/createMemo.test.ts`, solid-web `test/latest-async.spec.tsx`; INV-10 enforces the mask in dev |
| A21 | **The store-wide mask: for a derived optimistic store, the store is the primitive — any active optimistic write masks `isPending` for the *entire* store.** Written leaves, untouched siblings, structural reads (`length`, iteration), and the firewall's own refetch all read `false` while any override on the store is live, in both forms; the mask lifts when the store's optimistic state fully clears (same lane lifetime as A20). Rationale: a refetch pends the whole store because the authority's change set is unbounded (A9) — the decree that silences it must speak for the same unbounded scope, or `isPending(() => store.items.length)` would flip on a refresh the writer already declared the outcome of ("If I do `setOptimisticFormOptions(x => x.cities.push("London"))` then I expect the select to consider it settled" — same for `x.cities[i] = "London"`). Once you write optimistically you own the store's pending affordances (A20 §1: flags in the data). Consequences: (1) optimistic writes to the same store entangle — not just writes to the same property; (2) plain (non-derived) optimistic stores get this for free — with no source they were never pending from themselves (A20 §4); (3) A9 is the unmasked rule: with **no** active override, every leaf reports the firewall's refetch in both forms — the store-wide mask is an override-lifetime exception, not a repeal; (4) (added 2026-07-08) only **effective** writes arm the mask and entangle — the decree is about data actually asserted, so trap fires that change nothing (`s => s`, `s => ({ ...s })` replaying equal values, same-value property writes, deletes of absent properties) are no-ops with no decree, matching the signal path where an equal-value first optimistic write short-circuits before any override exists. A deliberate "silence this refresh" affordance is future explicit API (#2844 family), not an emergent no-op write. | GabbeV/maintainer, 2026-07-07c ("any optimistic write turns off isPending for the whole store"; "the store is the boundary"); effective-write gate ruled 2026-07-08 (brenelz/GabbeV probing `setOptStore(s => s)`) | "store-wide mask" pin in the A20 describe, `tests/spec-async-semantics.test.ts`; `tests/store/createOptimisticStore.test.ts` (refresh-pends → write-masks → lift contrasts); INV-10 store-mask arm |
| A22 | **Pending is per-node: store-wide verdicts exist only as the firewall's own in-flight work (A9) and the decree that silences it (A21).** Every other A19 cause lives on the individual node — a transition-held write to a plain store pends exactly the touched leaves (untouched siblings and proxy-level reads stay settled: the writer's change set is known, unlike a refetching authority's unbounded one), manual projection writes pend the written leaf only, holds outliving a settled firewall stay leaf-local. Direction of flow: a node's verdict never inherits its *consumers'* in-flight state — once a fetch commits, leaves show the landed value and read settled immediately, even while downstream async still holds the effect-level reveal (the commit is immediate at the data level; only the visual is lane-held, and `isPending` companions probe from their own lane, A14, so they are not fooled by the hold). | GabbeV plain-store demo + maintainer, 2026-07-08 ("probably not.. it's non optimistic and it isn't derived from an async source"; "this makes me want to keep things per property even more") | A22 describe in `tests/spec-async-semantics.test.ts` |
| A23 | **The `isPending` probe is reads-only — the thunk's return value is never inspected.** `isPending(() => store)` reads nothing and reports `false` by design: keying any behavior off the returned value is inconsistent under the probe's expression semantics (`() => store && other()` doesn't return the store; a child component reading `props.options` never has the store to return — the props issue). Whole-store questions are asked through reads: any leaf reports the firewall's refetch (A9), spread/iteration reads report structure. The accepted ergonomic complement is the **direct-argument form** `isPending(store)`, mirroring `refresh(store)` — *argument* inspection (a controlled API taking the store identity, no expression semantics), consulting the firewall: projections report their shared computation's refetch (A21-mask-aware for free), plain stores read `false` (no firewall — consistent with A22 and with `refresh`, which is also only meaningful for derived stores). Accepted 2026-07-08; implementation post-beta. | maintainer, 2026-07-08 (GabbeV ergonomics ask; "This isn't about returns.. the whole props issue again") | A23 describe in `tests/spec-async-semantics.test.ts` (reads-only half; direct form pinned when implemented) |

## Tier B (inferred — needs verdict)

Mark each **keep** or **change**; on *keep* it gets a spec test and moves to
Tier A.

- [x] **B4 — RULED, promoted to A18 (2026-07-07).** The original inferred
  statement ("async resolution must not clobber a user override") was
  rejected: overrides clear when **their own async source** resolves. Stale
  in-flight resolutions (initiated before the user's write) are dropped by the
  dirty-flag check in `asyncWrite`; they never clobber mid-lane. (The old
  `_overrideSinceLane` flag that also guarded this was removed 2026-07-07 —
  the re-ruled A18 hold model made its correction path unreachable.)

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
- **V4 (violated the old A20's three-form algebra) — FIXED, then the rule it
  enforced was superseded (2026-07-07c).** The durable half of the fix stands:
  the stuck-true companion is gone — a firewall's status change pokes the
  companions of its probed leaves (`updateChildCompanions`). The behavioral
  half (latest-form filtering a pure firewall refresh on a resting
  optimistic-capable leaf) was an artifact of the one-day "overrides are
  unsettled" ruling and is **gone**: under the re-ruled A9/A20, an in-flight
  refetch supersedes both channels, so **both** forms report it on a resting
  leaf — unless the store-wide mask (A21) is live. The pin now asserts the
  new algebra ("V4/A20: both forms report a pure firewall refresh on a
  resting leaf").

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

## Re-ruling log — 2026-07-07c: the mask model (#2844/#2728)

The "overrides are unsettled" algebra ruled on 2026-07-07 was reversed the
next day after the #2844 background-refresh discussion converged with GabbeV's
long-standing position (and the repo's own todos example, which already
managed per-row pending with co-written flags). One conceptual change — **an
override is certainty by decree, and verdicts follow the channel you read** —
rippled through:

- **A20** rewritten (the mask; `isPending` never reports an active override).
- **A21** added (store-wide mask for derived optimistic stores).
- **A8** re-ruled (`latest` is a self-written override → the latest form
  follows the source's own async only; never pending on signals/sync
  computeds).
- **A9** re-ruled (both forms report a firewall refetch on resting leaves;
  the old latest-form filter is gone; A21 is the only silencer).
- **A19** amended (decree exception joins the initial-NotReady exception).
- **A18** consequence (3) flipped (`isPending === false` during a merged
  correction window — the mask outlives the merge).
- **A14** re-scoped (the spinner pin drives on a plain refetch; optimistic
  writes no longer produce `true`).
- **V4** behavioral half superseded (its companion-poke fix stands).
- The would-be **V6** (flagged during the re-evaluation: the latest form
  reading `false` for an active override with no async in flight, which the
  old A20 called a violation) is not a violation — it is the mask working
  as specified. No entry in Known violations; the A20 pins cover it.
- **INV-10** added: dev-mode asserts a companion's observable verdict is
  `false` whenever its owner has an active override or its firewall's
  store-wide mask is up.
- **A21 consequence (4)** added 2026-07-08: the mask/entanglement arm only on
  *effective* writes. Previously arming ran in `prepareStoreWrite` before the
  equality short-circuit, so `s => ({ ...s })` and same-value writes masked
  while the semantically identical `s => s` did not — the boundary was "did a
  trap fire", not "did data change". Arming now happens per-trap after the
  effective-write determination (`armOptimisticStoreWrite`).
- **A22/A23** added 2026-07-08 (Discord follow-ups on the mask model): pending
  granularity is per-node everywhere outside A9/A21 (confirmed empirically:
  plain-store action write, projection + downstream async, derived store
  post-commit under a downstream hold), and the probe's reads-only contract is
  now explicit — with the direct-argument `isPending(store)` form accepted as
  the ergonomic complement (post-beta), closing GabbeV's `isPending(store)` /
  `isPending(() => store)` ask.

What did *not* change: A17 (override is THE value), A18's lifetime/hold
mechanics, A19's cause algebra for non-decreed data, A13/V1–V3/V5 (resting
nodes and the blocked-merged window), and lane architecture (same optimistic
lanes; the mask is a verdict rule, not a scheduling change).

## Process

1. Tier B/C items get a maintainer verdict (issue comment, chat, or edit this
   file).
2. On verdict: write the spec test, cite the verdict date here, move to Tier A.
3. Tier A tests are spec. A PR that changes one must say *why the design
   changed*, not "updated expectations".
