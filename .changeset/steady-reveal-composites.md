---
"solid-js": patch
"@solidjs/signals": patch
---

Fix nested `Reveal` readiness across the client and streaming SSR.

Empty or synchronously resolved composites now count as minimally ready, so an
enclosing `order="together"` group cannot deadlock. Nested `order="natural"`
groups also report readiness as soon as one direct child is minimally ready,
and nested client `order="together"` groups propagate the same direct-slot
readiness they use for their own release. Readiness and completion on the server
are held until all synchronous child slots have registered, preventing an early
child from making a partially constructed group release prematurely.
