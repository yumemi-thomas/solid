---
"@solidjs/signals": patch
---

Ineffective optimistic store writes no longer arm the store-wide isPending mask or entangle the transition. Previously the mask armed on any write-trap fire before the equality short-circuit, so `setStore(s => ({ ...s }))` (which replays every key with equal values) and same-value property writes silently decreed the store settled while the semantically identical `setStore(s => s)` did not. The mask and reversion tracking now arm only when data actually changes, matching the signal path where an equal-value first optimistic write creates no override.
