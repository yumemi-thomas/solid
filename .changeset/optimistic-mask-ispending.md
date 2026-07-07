---
"@solidjs/signals": minor
---

Optimistic overrides now mask `isPending` — an active optimistic write is "certainty by decree" (#2844, #2728)

- An active optimistic override reads `isPending === false` for its whole
  lifetime, on every node kind and in both probe forms. `isPending` is
  reserved for data being updated by machinery the reader did not decree
  (refetches, transition-held commits) — never for the provisional nature of
  an override. Action affordances ("Saving…") belong in the data as
  co-written flags or a separate `createOptimistic(false)`.
- For derived optimistic stores the mask is store-wide: while any optimistic
  write on the store is live, the entire store (written leaves, untouched
  siblings, structural reads, the firewall's own refetch) reads settled. The
  mask lifts when the store's optimistic state clears. Background polling
  falls out: `refresh(store); setStore(s => …reassert…)` revalidates silently.
- `isPending(() => latest(x))` now follows `x`'s own in-flight async only:
  `latest` acts as a self-applied override the moment a held value exists, so
  transition holds no longer read pending through it; it is never pending on
  signals or sync computeds.
- Store leaves report a firewall refetch in both probe forms (the old
  latest-form filter is gone; the store-wide mask is the only silencer).
- Companion verdicts now revert when their owner is disposed (no
  latched-`true` spinner for a dead source — the #2845 edge).
- Dev/test invariants INV-9 (disposal) and INV-10 (mask, both node- and
  store-scoped arms) enforce the new semantics; dead lane-merge and probe
  special-case paths were removed.

See `SPEC-ASYNC-SEMANTICS.md` (A8/A9/A19/A20/A21 re-rulings, 2026-07-07c) and
`INTERNALS-ASYNC-STATE.md` §5f for the full ruling and implementation notes.
