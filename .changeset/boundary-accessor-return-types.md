---
"@solidjs/signals": patch
"solid-js": patch
---

`createErrorBoundary` and `createLoadingBoundary` now return a properly typed `Accessor<T | U>` (content union fallback) instead of `() => unknown`, with the same external signature across the core, client hydration, and server layers.
