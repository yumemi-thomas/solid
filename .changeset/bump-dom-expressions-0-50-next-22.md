---
"@solidjs/web": patch
---

Bump dom-expressions to next.22. Beyond the server-functions runtime, the bundles pick up a deduplicated `DOMElements` set (~1 KB minified for consumers that retain it) and hydration-time insert/event behaviors moved behind a runtime slot installed by `hydrate()`, so client-only bundles tree-shake them.
