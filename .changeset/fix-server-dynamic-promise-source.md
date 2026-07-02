---
"@solidjs/web": patch
---

Server `dynamic()` now supports Promise sources (#2779). A Promise component/tag source previously fell through the sync function/string checks and rendered nothing. It now follows `lazy()`'s SSR contract: block async renderers and throw `NotReadyError` from a sync memo until the promise lands, so the streaming engine captures the position as a retry hole. Requires `@dom-expressions/runtime` 0.50.0-next.15, where awaited `renderToStream` waits out blocked root holes.
