---
"@solidjs/signals": patch
---

Fix `reconcile()` mishandling store proxies held as values (#2825). The diff's `unwrap` helper read the internal signal-node record (`STORE_NODE`) instead of the store's value, so reconciling data containing store proxies leaked internal Signal records into store reads (breaking `JSON.stringify` with a circular-structure error) or silently dropped keyless swaps; keyed reorder of an array whose items are store proxies crashed with a stack overflow. Proxies are now normalized to their raw value at the diff entry, restoring identity-preserving merges across the proxy boundary.
