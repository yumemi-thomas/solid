---
"@solidjs/signals": patch
---

Streamline the isPending()/latest() internals: remove a dead branch in `computePendingState`, consolidate the tripled companion-node bookkeeping (setSignal / async resolution / transition-held recompute) into a single `syncCompanions` helper, collapse the four isPending probe globals into one probe object, and deduplicate node preparation in `read()`. No behavior change; slightly smaller bundle.
