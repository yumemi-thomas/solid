---
"@solidjs/web": patch
---

Bridge the settled server-function extension surface through `@solidjs/web/server-functions`: `GET(fn)`, the declaration-metadata channel (`withMeta`, `getServerFunctionMetadata`, `isServerFunction`), and the `prepareRequest` client hook — and drop the legacy per-reference `.GET`/`.withOptions` escape hatches (beta, no compatibility shims).

- **`GET(fn)`** declares a server function callable over HTTP GET (arguments codec-encoded in the query string, cacheable URLs). Both environment halves export it: the browser build's returns the GET-transport callable, the server build's is identity-flavored (SSR stays in-process) and records the declaration so the handler answers 405 when the request method contradicts it. Function-level `"use server"` directives round-trip the wrapper call, so `export const getUser = GET(async (id) => { "use server"; ... })` needs no compiler support.
- **`withMeta(fn, meta)`** attaches arbitrary user-declared transport metadata to a reference through the same channel and returns it, shallow-merging later writes; it composes with `GET` in either order. `getServerFunctionMetadata(fn)` reads the merged bag and `isServerFunction(fn)` is the structural guard — both detect by a registered-symbol brand, so they work across the separately bundled client/server entries; routers use them instead of property sniffing.
- **`prepareRequest(init, { id, meta })`** on `configureServerFunctionsClient` (with the exported `PrepareRequestHook` type) runs before every outgoing server-function fetch — session-dynamic transport policy like OAuth bearer tokens, keyed per-function through `withMeta` declarations rather than id comparisons.
- References keep the callable, `url`, and now expose `id` on both sides; `.GET` and `.withOptions` are gone — session-dynamic uses go through `prepareRequest`, and single-flight opt-in is already automatic via `subscribeFlightData`.
