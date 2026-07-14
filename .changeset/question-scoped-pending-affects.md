---
"@solidjs/signals": minor
"solid-js": minor
---

Question-scoped pending model and the `affects()` primitive (supersedes the optimistic mask)

`isPending` is re-derived from one rule: a read is pending iff a value change is in flight for it that has not yet revealed, or it carries a live `affects()` mark.

- **Same-question re-asks are silent.** `refresh()`, polling, and confirm refetches whose tracked inputs are value-stable no longer read as pending — the fresh value reveals silently.
- **New questions pend monotonically.** An input value change in flight pends every read under the source until its answer reveals, and nothing can silence it.
- **Optimistic writes are verdict-inert.** An active override displays without decreeing settlement: it neither reads pending on its own slot (only a differing held correction re-opens the verdict) nor masks anything else. The store-wide optimistic mask (A21) and node mask (A20) are removed.
- **New `affects(target, ...keys)` primitive** (re-exported from `solid-js`). Declares that in-flight work will change the targeted data: the named slots (a store record, specific record keys, or a source accessor) read pending from the declaration until the surrounding transaction settles or reverts. `affects(x); refresh(x)` is the declared-reload idiom.
