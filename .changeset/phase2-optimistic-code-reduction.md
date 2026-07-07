---
"@solidjs/signals": patch
---

Code reduction pass over the optimistic machinery. Remove dead override-correction paths made unreachable by the hold model (`_overrideSinceLane` flag, the non-lane recompute correction, setSignal equal-write re-propagation). Consolidate the store's three-layer value resolution behind `getOverlayLayer`/`visibleNodeValue` chokepoints so every proxy trap resolves optimistic → override → base identically.
