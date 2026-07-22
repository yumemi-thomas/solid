---
"@solidjs/signals": patch
---

Fix `snapshot()` returning the inner store's live proxy for rows accessed through a derived store view (e.g. `createOptimisticStore(base)` over an existing store). The no-overlay fast path mapped a row to its node's `STORE_VALUE` verbatim, but for store-in-store nodes that value is the inner store's proxy — so per-row snapshots (`snapshot(view[i])`) leaked a live, writable proxy while whole-store snapshots were plain. Chained store proxies now unwrap recursively to the raw backing object.
