---
"@solidjs/signals": patch
---

Extend test-mode invariant machinery for the async/companion redesign pre-work: INV-8 pending-hold provenance (every held `_pendingValue` is tagged as an optimistic revert target or a transition/refetch hold, and the #2799 resting carve-out is probed for muting refetch holds — the V1 root cause), INV-9 (a disposed owner's isPending companion must not report a phantom `true` at quiescence). Rule and pin A20 semantics: an active optimistic override reads `isPending === true` uniformly (overrides mask stale content, not settlement), pending scope follows the read, and `latest` strips coordination but never confirmation — with the latest-form store-leaf filter pinned as expected failure V4.
