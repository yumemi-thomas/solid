---
"@solidjs/signals": patch
---

Fix `reconcile()` leaving stale per-index and `has` nodes on array resize (#2823). After a shrink, tracked reads of removed indices now update to `undefined` and untracked reads agree with `length` instead of serving the removed row from the leftover node; `in` checks update in both directions (removed indices report `false`, indices added by growth report `true`). Node sync is membership-based (`key in next`), so sparse holes and named array properties are unaffected.
