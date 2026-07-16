---
"@solidjs/signals": patch
---

Tighten the #2893 guards: addPendingSource collapses to a single branch chain off the container invariant, notifyStatus derives its mark check with one optional-chain read, and recompute's pending-commit gate does a single status-mask test so the mark-free hot path pays exactly the pre-#2893 cost. No behavior change.
