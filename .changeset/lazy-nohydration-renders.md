---
"solid-js": patch
---

Fixed `lazy()` inside `<NoHydration>` silently rendering nothing during SSR (#2859). The moduleUrl/manifest guards are intentionally waived for no-hydrate zones, but the early return that gated asset registration also gated the render memo — so exactly those waived cases returned `undefined` and the lazy content vanished from the output with no error. Asset registration is now decoupled from rendering: the render memo is always created, and async SSR waits for the module as usual. Also fixed the lazy module rejection check treating a falsy rejection value as "still loading" (same class as #2857).
