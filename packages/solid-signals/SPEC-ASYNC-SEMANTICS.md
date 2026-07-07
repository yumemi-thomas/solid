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
| A18 | (was B4) An override's lifetime is bound to **its own async source**, not its transition. When the node's own fetch resolves, the authoritative value wins immediately — the override clears/corrects to the fresh value (never the pre-write value) — even while unrelated async in a merged transition is still pending. Rationale: "otherwise unrelated parts of a transition get held up waiting for other async to resolve, especially if the optimistic value needs correction and triggers further async" — the correction cascade must start on arrival. | maintainer ruling, 2026-07-07 | `tests/spec-async-semantics.test.ts` |
| A19 | (was C1 — **partially reverses an earlier decision**) **Definition: `isPending(x)` ≡ the value you can currently observe for `x` is not the final one.** Three causes of non-finality, each ending on its own terms: (i) a write held by a live transition — ends at commit; (ii) the node's own async in flight — ends at resolution; (iii) a fresh value that arrived but is held uncommitted by a transition it's entangled with — ends at that commit. A node is pending while *any* cause holds it and final the moment none does — cascading async falls out of the definition rather than needing a rule ("once it can show its landed value it is no longer pending"). **The one boundary-scoped exception is the initial NotReady**: an uninitialized source is *loading*, not pending (A16/A12) — no observable value exists to be non-final — and its thrown `NotReadyError` must propagate to loading boundaries (A16/B5a) because SSR streaming and hydration reveal are driven by boundaries. Everywhere else, boundaries and reporters never enter the definition: they decide what renders and what a transition waits for, not verdicts. The rejected earlier framing ("if it isn't read somewhere that reports to the transition, it isn't actually pending") was a proxy for cause (i) wrongly applied to causes (ii)/(iii), tying data verdicts to graph-topology accidents. Causes (ii)/(iii) implementation lands with the #2838 shadow/companion redesign; until then the post-transition refetch window misreports `false` — pinned as expected failure **V3** (and V1 is the cause-(iii) instance). | maintainer ruling, 2026-07-07 | cause (i) + boundary interplay: `tests/spec-async-semantics.test.ts`; causes (ii)/(iii): `tests/spec-async-open-questions.test.ts` (V3/V1, `it.fails` until the redesign) |

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

## Known violations (expected failures, found 2026-07-06)

Two ruled Tier A propositions are violated in the **blocked-merged window**
(a node's own fetch resolved, but a shared reader entangles it with another
still-pending async source, so nothing commits). Reproduced as `it.fails`
cases in `tests/spec-async-open-questions.test.ts` — when one starts passing,
its bug is fixed and the test should move to the spec file:

- **V1 (violates A13).** A *resting* optimistic node reports
  `isPending === false` in the window while still showing the stale value;
  the plain-memo control reports `true` at the same checkpoint. Root cause:
  `computePendingState`'s #2799 carve-out skips the held `_pendingValue` for
  every resting optimistic node, but here the held value comes from an
  entangled refetch, not a reverting optimistic write. A fix must
  distinguish those two reasons for holding a value.
- **V2 (violates A7/A13).** `latest()`'s verdict in the window is
  *read-order dependent*: a probe made while both fetches are in flight
  freezes the shadow at the stale value for the entire window, and override
  interleavings surface `[isPending, latest] === [false, undefined]` — the
  pair A7 rules out. Root cause: the probe-driven shadow design (#2838);
  verdicts must not depend on when a consumer happened to read.
- **V3 (violates A19, ruled 2026-07-07).** In pure-signals graphs the
  transition completes while the refetch is still in flight; an existing
  `isPending` companion keeps its lane-scoped verdict (`false`) through the
  window even though `latest()` still shows the stale value. A19 says
  pending is a property of the data (refetch in flight + stale value
  visible), so this must read `true`. Root cause: the companion caches a
  boundary-scoped verdict instead of deriving from the data's state —
  same design family as V1/V2, fixed by the #2838 redesign.

## Process

1. Tier B/C items get a maintainer verdict (issue comment, chat, or edit this
   file).
2. On verdict: write the spec test, cite the verdict date here, move to Tier A.
3. Tier A tests are spec. A PR that changes one must say *why the design
   changed*, not "updated expectations".
