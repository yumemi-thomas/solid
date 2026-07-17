---
"@solidjs/signals": patch
---

Keyed `affects(store, key)` marks now resolve by raw identity like keyless marks, so they are visible through other proxy families sharing the same backing record — e.g. a derived optimistic store whose projection landed the source store's value (#2904)
