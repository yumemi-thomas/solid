---
"@solidjs/signals": patch
---

Add the INV-2 test-mode assertion (an active optimistic override must hold a revert target and stay registered for reversion) and characterization tests for the open async semantics questions (B4, C1, C4), including two known ruled-spec violations in the blocked-merged-transition window pinned as expected failures.
