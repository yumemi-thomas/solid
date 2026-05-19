---
"@solidjs/signals": patch
"solid-js": patch
"@solidjs/web": patch
---

Make `isPending(fn)` perform the read it checks, so pending indicators subscribe naturally and ownerful async reads participate in Loading/SSR readiness.
