# Design: `affects` — declared data scope for in-flight work

> Status: **designed, deferred to post-2.0** (leading candidate for the
> first minor — purely additive: one new export, one opt-in verdict cause;
> nothing in 2.0 forecloses it, and the co-written-flag pattern in the todos
> example remains the documented answer until then). All rulings settled
> 2026-07-08. Nothing here is implemented. Companion to
> SPEC-ASYNC-SEMANTICS.md — the rulings there (A19–A23) define the
> boundaries this primitive must not cross.

## Problem: the dead window

`isPending` is graph-scoped. It reports machinery: a write held by a
transition, a refetch in flight. But the real work of most actions happens
**off-graph**, and during that window the graph is genuinely idle:

```ts
const save = action(async (todo) => {
  await api.save(todo);   // ← the entire window: nothing is pending anywhere
  refresh(todos);         // ← machinery pending only starts here
});
```

For the whole `await` — most of the action's lifetime — `isPending` has
nothing to report. No held write, no refetch. The row spinner is dark exactly
when the user most expects it lit; `isPending` lights only for the tail, once
the refetch begins. The repo's todos example covers this window by hand,
co-writing a `pending` flag into the data alongside its optimistic updates.
That's the boilerplate this design removes: the writer already knows, at the
write site, which data its process is working on — the system just doesn't
record it.

The gap also shows as inconsistency between components (the two-button demo,
2026-07-08): a generic async button drives its affordance with a private
`createOptimistic(false)` flag, an incrementor uses `isPending` on the count
they both touch. The incrementor's activity is visible to everyone through
the graph; the generic button's is process-private and visible to no one.

## Proposal

### Declaration

`affects(target)` called in **any writable scope** — everything in Solid is a
transition, so the declaration binds to the ambient transaction whether
that's an `action()` invocation or a plain event handler's writes:

```ts
const toggleTodo = action(async (id: string) => {
  const todo = todos.find(t => t.id === id)!;
  affects(todo);                // runtime identity — this row, this invocation
  await api.toggle(id);
  refresh(todos);
});
```

```ts
// no action, no write — a boundary reset declaring what it touches:
<button onClick={() => { affects(phrase); reset(); }}>Retry</button>
```

- Per-invocation declaration is the primary form because the real cases are
  dynamic: the affected row is an argument, not a static binding. A static
  `action(fn, { affects: [...] })` option is rejected as the primary API for
  that reason (could be sugar later for the static-target case).
- Valid targets: a signal accessor, a store proxy (whole store), a nested
  store proxy (row/branch). Store *leaves* are declared via their parent
  proxy — leaf reads produce values, not identities.

### Query: there isn't one — it feeds `isPending`

`affects` contributes to the existing `isPending` verdict. No `isAffected`,
no second probe. The unified reading:

> `isPending` is true while machinery is moving the data **or** an in-flight
> process has declared it is working on the data.

Both are "this data is in motion" — one discovered from the graph, one
declared because it is invisible to the graph. The reader cannot tell the
difference and should not have to.

A separate `isAffected` channel was considered and rejected: the only read it
enables that the union doesn't is "intent but not machinery" (or vice versa),
which no one has asked for — while the common case would force every consumer
to write `isPending(x) || isAffected(x)` and to understand the
machinery/intent taxonomy just to render a spinner. An API whose correct
usage is almost always `a(x) || b(x)` is one API.

Feeding `isPending` also inherits everything already ruled: the reads-based
probe and direct-argument form (A23), per-node granularity (A22), and normal
downstream propagation — data declared in-motion reads as in-motion through
derivations, no bespoke subsumption policy.

### Why not fold it into `refresh`?

`affects(x); …; refresh(x)` is often a pair, so tying the declaration to
`refresh` is tempting. Rejected as the primary form, for three reasons:

1. **Wrong end of the window.** `refresh` fires *after* the await — the
   exact moment machinery pending takes over anyway. The declaration must
   exist from the *start* of the dead window, which is before any graph
   operation happens.
2. **Targets differ.** The common shape affects a *row* but refreshes the
   *store* (`affects(todo)` … `refresh(todos)`). One call can't carry both
   identities without conflating them.
3. **The pair isn't mandatory.** A mutation may end in a websocket push, a
   targeted store write, or nothing at all — no `refresh` to hang the
   declaration on. Same reason it can't be an option on a write: the
   motivating case may contain no write until the end, or ever.

Sugar that combines them could come later; the primitive stands alone.

### Semantics

- **Lifetime**: the optimistic-override lifecycle (A18), verbatim. A
  registration clears when its target's source refresh lands or when its
  transaction fully completes — not when the writer's own function returns
  (an action can settle while the `refresh` it fired is still in flight; the
  declaration holds through that tail, so the spinner clears when the data
  lands). Refcounted: overlapping transactions (two rows saving) each hold
  their own registration; the verdict contribution clears when *its* count
  hits zero. No new lifecycle — piggybacks the machinery `_optimisticNodes`
  already has. (Ruled 2026-07-08.)
- **Transaction semantics of the declaration itself**: `affects` is a
  transaction operation with write semantics — it joins the ambient
  transaction if one exists and **starts one if not**. This matters because
  the declaration is typically the *first* line of a handler, before any
  write has opened anything; the transaction it starts is the one subsequent
  writes and awaits join. A degenerate declaration nothing joins completes
  at end of tick — a one-tick blip, no error case. (Ruled 2026-07-08.)
- **Observational at the async level**: `affects` participates in
  transaction *membership* like a write (joins/starts, above) but never
  affects transaction *completion* — no async blockers, no `_asyncNodes`
  writes, no lane merging (hard line — see
  `.cursor/rules/async-registration-invariants.mdc`). The transition settles
  on its own schedule; the registration just clears when it does. Beyond
  membership it contributes to *verdicts* only: a registry entry and a
  companion-signal poke.
- **Independent of graph causality**: a process can declare data it never
  entangles (fire-and-forget POST) and entangle data it never declared;
  the verdict is the union either way.

## `affects` IS optimistic state

The reduction that organizes everything above: the todos example's co-written
`pending` flag is optimistic state — a boolean in the optimistic layer, set
alongside the value write, auto-reverting at transition completion. `affects`
is that flag, system-managed. It is an **optimistic write whose target slot
is the pending verdict instead of the value**:

- decreed, not inferred (like an override, unlike machinery pending);
- transaction-scoped with write semantics (joins/starts — ruling 5);
- override lifecycle (source refresh landing / transition completion —
  ruling 4);
- and therefore *no conflict with the mask*: the value override decrees "the
  value is X, render it settled"; the declaration decrees "motion is
  happening on this data, report it". Different slots, both first-class.
  A20's mask silences inferred machinery only (ruling 2).

Components without data identity keep using `createOptimistic(false)`
directly; `affects` is the same decree keyed by data identity so *any*
reader of the data can see it. One structural difference from value
overrides: overlap. Two transactions can hold the assertion on one node
simultaneously, so it's a refcount (or per-lane registration), not
last-write-wins.

## Mechanism sketch

The load-bearing choice: **state lives on the node as a count, never as a
written companion value**. The pending companion is an `optimisticSignal`
re-derived from `computePendingState` at every sync point
(`updatePendingSignal`, `snapCompanionsToState`, disposal) — a written
`true` would be clobbered by the next recomputation. A refcount consulted
*by* the verdict function survives every re-derivation for free.

- **Core verdict + poke** (~30 lines): `_affectsCount?: number` on the node;
  a first-class cause in `computePendingState` placed right after the
  `REACTIVE_DISPOSED` guard and *before* the `_optimisticMask` /
  `hasActiveOverride` early-false returns — check order IS ruling 2. The
  `latest` branch (`_parentSource`) consults the parent's count too: the
  declared motion is off-graph, there is no fresher value for `latest` to
  show. 0↔1 transitions call the existing `updatePendingSignal(el)`.
- **`affects()` export** (~50 lines): resolve target → node with the same
  shallow controlled-argument resolution `refresh` uses (signal accessor →
  node; store proxy → `StoreNode`/firewall); increment; register the
  decrement with the ambient transaction (starting one if absent — the
  write path); idempotent per transaction.
- **Transition lifecycle** (~60–80 lines, the risk concentration): a
  registration list on `Transition` parallel to `_optimisticNodes`;
  decrement where `resolveOptimisticNodes` runs at completion; the
  source-refresh early clear hooks the same async settle path that clears
  value overrides. Hazards are exactly where optimistic nodes already need
  care: **transition merging** (registrations must merge like
  `_optimisticNodes` or a count strands at nonzero — a spinner that never
  stops) and **stashed transitions**. Test the latch hardest.
- **Store rows** (~50 lines): for `affects(todoRow)` to light
  `isPending(() => todo.done)`, the probe must see the row, not just the
  leaf — probe-time collection in the store `get` trap (when `pendingProbe`
  is active, each proxy hop registers its node record). Module-null check on
  a path already doing trap work; non-probing reads pay nothing.

Ripples: INV-10 needs *amending* (companion may be `true` under an active
override when `_affectsCount > 0` — declaration wins); a new spec A-rule
plus a carve-out in A20/A21 consequences. No new lifecycle, queue, or probe:
one integer, one cause, two existing hook points. Rough cost: 250–350 src
lines across `core.ts`/`scheduler.ts`/transaction plumbing/`store.ts`,
comparable test weight, ~+0.5–1KB minified, near-zero hot-path cost.

## Rulings (settled 2026-07-08)

1. **Naming**: `affects(target)`. Honest about scope — you can affect
   without mutating (a boundary reset, a fire-and-forget); `mutates`
   overpromises a write, `markPending` reads as machinery rather than
   intent.
2. **Mask precedence**: declaration wins — but see "affects IS optimistic
   state" below: there is no real collision. The value override and the
   declaration are decrees on *different slots* (value vs motion), so the
   A20/A21 mask — which silences *inferred* machinery pending — never
   applied to decreed pending in the first place. A transaction that
   declares `affects(todo)` and writes an optimistic override covering it
   reports pending, which is exactly the hand-built todos UX (optimistic
   toggle + "Saving…").
3. **Store-row identity**: proxy identity (WeakMap on the wrapped node).
   Solid-native, survives reorders; a registration dies if `reconcile`
   replaces the underlying object mid-flight — accepted as correct (new
   object, new identity). Revisit only if this bites in practice.
4. **Lifetime**: the optimistic-override lifecycle — clears on source
   refresh landing or transition completion, holds through the tail after
   the writer's function settles. (See Semantics.)
5. **Declaration without an ambient transaction**: starts one, exactly as a
   write would. No error case. (See Semantics.)

## Relations

- **A19** — this adds a new *cause* to the `isPending` verdict (declared
  in-flight work), alongside the machinery causes. It does not change what
  machinery reports.
- **A20/A21** — the mask model stands unchanged for machinery; when an
  optimistic write and a declaration share a target, the declaration wins
  (ruling 2).
- **A22** — per-node granularity applies: declarations light the declared
  node (and normal propagation from it), not the whole store.
- **A23** — the probe contract (reads-only; direct-argument form for
  identity questions) applies verbatim, since the query *is* `isPending`.
- **#2844 family** — background refresh: with intent declarable, readers get
  "user activity" signals without silencing machinery reporting.
- **todos example** (`examples/todos/src/todos.ts`) — the co-written
  `pending` flag is exactly what this replaces.
