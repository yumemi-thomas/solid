---
"@solidjs/signals": patch
---

Stop lane merges from transferring transaction ownership of optimistic overrides (#2912). A shared subscriber (one effect reading values touched by two actions) merges their lanes for effect scheduling — correct — but `resolveTransition` followed the merged lane's transition, so one action's settle could revert another action's live override and same-key follow-up writes entangled with the wrong transaction. Optimistic writes now stamp the owning transaction on the node (`_overrideOwner`, the node-level sibling of #2899's `STORE_OPTIMISTIC_OWNERS`), and `resolveTransition` prefers a live owner stamp over the lane.
