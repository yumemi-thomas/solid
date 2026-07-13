---
"solid-js": patch
---

Server `lazy()` now supports resolver manifests (dev servers answering asset
lookups from their live module graph): when `ctx.resolveAssets` returns a
promise, registration defers with boundary attribution preserved and the
lazy render memo stays not-ready until the assets have registered, so
streamed fragments cannot flush without their styles. CSS entries resolved
as `{ id, content, attrs }` descriptors register as `inline-style` assets
(SSR'd `<style>` tags, e.g. dev CSS that Vite's HMR client adopts) instead
of stylesheet links. The `moduleUrl` getter (islands) prefers the context's
`resolveAssetsSync` fast path, so it keeps returning a client-loadable URL
and registering modulepreload hints under async dev resolvers too.
