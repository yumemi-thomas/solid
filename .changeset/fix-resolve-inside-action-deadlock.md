---
"@solidjs/signals": patch
---

Fix `resolve()` created inside an `action()` never settling and deadlocking the action (#2930): the promise was delivered from a user effect's apply phase, which an incomplete transition stashes until it settles — but the action yielding that promise is itself what keeps the transition open. `resolve()` now delivers effect applies on a microtask (immune to the transition stash) while computes still run in place under the transaction's view; status/boundary notifications keep their normal queue route.
