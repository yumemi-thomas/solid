---
"@solidjs/signals": patch
---

Fix `latest()`/`isPending()` consistency gaps (#2831): store-leaf reads now report the firewall's refetch as pending; `[isPending(x), x()]` can no longer pair pending with the fresh in-flight value for non-stale readers; and sync derivations of transition-held sources (a memo over a held signal) are now visible to `latest()` and `isPending()` — the transition-held sync recompute path maintains the same companion nodes as `setSignal` and async writes.
