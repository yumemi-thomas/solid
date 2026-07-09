---
"solid-js": patch
---

Fixed two SSR async-source regressions from 1.x (#2857, #2858):

- A rejection with a falsy value (`undefined`, `null`, `""`, `0`, `false`) was treated as resolved by the server memo read path — the HTML rendered the success branch while the hydration payload serialized the same source as rejected. Error presence on server computations is now tracked as a flag instead of a truthiness test on the error value, so falsy rejections render the `Errored` fallback exactly like truthy ones.
- Server async detection only recognized native `Promise` instances, so a non-Promise thenable (PromiseLike) returned from a memo was stored as a sync render value and skipped by the renderer with "Unrecognized value". SSR now uses the same object-thenable detection as the client async runtime (async-iterable takes precedence, matching client order): thenables under `<Loading>` are awaited and rendered, and without a boundary they surface the same missing-boundary diagnostic as a native `Promise`.
