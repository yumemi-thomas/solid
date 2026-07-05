---
"solid-js": patch
---

A rejected chunk preload no longer hangs boundary hydration forever (#2817 layer 3). Every asset-wait path in `createLoadingBoundary` now handles rejection: the error is reported via console and the boundary resumes with a fresh client render (`shouldHydrate=false`), letting `lazy()`'s own `import()` retry or fail through normal error channels.
