---
"@solidjs/signals": patch
---

Fix `createReaction` crashing with `Cannot read properties of null (reading '_dep')` when the invalidating rerun of the tracked callback reads zero dependencies. `dispose()` now guards its dependency-unlink loop instead of unconditionally calling `unlinkSubs` once.
