---
"@solidjs/signals": patch
---

Fix store property descriptors reporting stale values after `setStore` writes. `Object.getOwnPropertyDescriptor(store, key)` and `Object.getOwnPropertyDescriptors(store)` now agree with proxy reads for written string and symbol keys while preserving the source descriptor's flags. Writes over prototype-inherited properties now also report an own descriptor and no longer crash `snapshot()`.
