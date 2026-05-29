---
"@solidjs/signals": patch
"solid-js": patch
---

Remove the public `isRefreshing()` API and treat `refresh()` as write-like invalidation in dev owned-scope diagnostics.

`refresh()` is an action that invalidates an explicit refresh target; it should not expose ambient phase state to pure computations. User-visible mutation or retry intent should be modeled with actions and optimistic state, while readiness remains observable through `Loading` and `isPending`.
