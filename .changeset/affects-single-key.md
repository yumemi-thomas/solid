---
"@solidjs/signals": patch
"solid-js": patch
---

Narrow `affects()` to a single optional key: `affects(target, key?)`. The variadic form read like a 1.x store path (`affects(state, "user", "name")` suggests `state.user.name` but marked two sibling slots) — mark multiple slots with multiple calls, or target the nested record directly. Passing more than one key now throws in dev.
