---
"solid-js": patch
---

Stop SSR from silently swallowing errors thrown in server effects. `serverEffect` now re-throws real errors so a wrapping `createErrorBoundary`/`<Errored>` can catch them (matching the client/hydration path), while still propagating `NotReadyError` as suspense control flow (#2777).
