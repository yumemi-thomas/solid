---
"@solidjs/signals": patch
---

Fix first-settling action wiping other in-flight actions' optimistic store overrides (#2899). The optimistic layer is one record per store target, and settle cleared it wholesale — two concurrent actions writing disjoint keys of the same `createOptimisticStore` visibly reverted the still-pending one the moment the other finished. Layer entries are now stamped with their owning transaction and a settling action consumes only its own keys (merge chains resolved, so same-key entanglement still settles jointly). Ambient writes keep clearing at plain flush end, and a derived store's projection landing still consumes the whole layer.
