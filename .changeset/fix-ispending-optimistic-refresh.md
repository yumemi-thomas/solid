---
"@solidjs/signals": patch
---

Fix `isPending` not reporting pending during a `refresh()`/refetch of an async `createOptimistic` accessor (#2799). A resting optimistic node (no active override) now reports pending exactly like a plain async memo while a refetch is in flight with stale data; muting pending remains the job of an active optimistic override only.
