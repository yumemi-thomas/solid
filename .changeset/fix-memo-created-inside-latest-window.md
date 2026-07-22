---
"@solidjs/signals": patch
---

Fix memos created inside a `latest()` read window never re-running (#2926): the creation-time eager compute ran with the latest-window flag set, so every source read short-circuited through the companion path before dependency linking, leaving the memo permanently dependency-less. `compute()` now suspends the latest window while a computed's own fn runs.
