---
"@solidjs/signals": patch
---

Restored 1.x replacement semantics for `createReaction` (#2861): calling `track()` again before the reaction fired now disposes the superseded arm instead of accumulating it. Previously every `track()` call created a new deferred effect that stayed alive until it individually fired — superseded sources still fired the callback, each accumulated arm delivered its own fire, and un-fired arms leaked as live effect nodes under the owner.
