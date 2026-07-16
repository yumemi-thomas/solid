---
"@solidjs/signals": patch
---

Fix mergeTransitionState duplicating optimistic nodes: the outgoing transition's \_optimisticNodes are now moved (not copied) into the target, so the adoption pass in initTransition can't re-push the same entries when overlapping actions merge.
