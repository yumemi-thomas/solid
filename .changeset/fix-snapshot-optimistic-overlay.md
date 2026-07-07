---
"@solidjs/signals": patch
---

`snapshot()` and `deep()` now read through the optimistic overlay on `createOptimisticStore` (#2850), agreeing with every other reader: an active optimistic write is THE value (A17), and snapshot's documented behavior on regular stores is already to read the pending-write overlay synchronously. Resolution order matches the proxy traps and `reconcile` (optimistic over regular). Also lands the specialized no-overlay snapshot walk deferred from #2756.
