---
"@solidjs/signals": patch
---

Store hot-path trims, measured on high-frequency full-graph updates (dbmon-shaped: reconcile of a fresh 7k-object graph + ~13k effect re-reads per tick, ~9% faster end to end):

- The proxy `get` trap takes a dedicated fast path for the common shape of an effect re-read — an existing node on a plain target (no firewall, no override layers, no write scope, raw source) — paying one node read and the wrap check instead of the full layered resolution.
- `StoreNode` targets now pre-initialize every field in one fixed order (`createStoreProxy`), so all targets share a single hidden class and the traps' and reconcile's field loads stay monomorphic; the field `delete`s in optimistic-layer teardown and snapshot clearing became `undefined` assignments to preserve the shape.
- `applyStateFast`'s object diff iterates plain string-keyed node records with `for...in` instead of allocating a fresh `Object.keys` array per object per pass (tracked and symbol-keyed records keep the array path).
