---
"solid-js": patch
---

Fix late-streamed `<Loading>` fragments being orphaned/duplicated during hydration when a chained async memo recomputes between stream chunks. A computation is now treated as still hydrating while the overall lifecycle is in progress (`!done`) and it has an unconsumed serialized value, so it short-circuits to the server's deferred value instead of re-running its async body on the client.
