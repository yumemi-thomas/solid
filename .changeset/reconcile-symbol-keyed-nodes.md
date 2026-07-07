---
"@solidjs/signals": patch
---

Fix `reconcile()` updates for symbol-keyed store properties so tracked reads and `in` checks are notified like string-keyed properties.
