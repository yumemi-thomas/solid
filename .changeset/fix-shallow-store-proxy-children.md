---
"@solidjs/signals": patch
---

Fix a shallow store leaking writes across a derived chain when it holds another store's proxy (#2932). Shallow ingest sticky-marked the ingested value raw — but the mark is global, so marking a live store proxy made every store serve it verbatim: a downstream deep store captured the upstream proxy instead of wrapping it in its own family, and its writes landed in the upstream store's override layer. Store proxies now pass through the shallow boundary unmarked (slot semantics unchanged: replaced by reference), so each store wraps them in its own family and write isolation matches the non-shallow chain. Also fixes the set-trap ingest mark being inert unless a raw mark already existed somewhere (`rawValuesUsed` was never flipped).
