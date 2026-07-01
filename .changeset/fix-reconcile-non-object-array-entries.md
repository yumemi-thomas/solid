---
"@solidjs/signals": patch
---

Fix keyed `reconcile` crashing on non-object array entries (#2772): a keyed `reconcile(..., key)` threw when an array held `null`/`undefined`/primitive entries, because the keyed diff passed them to `keyFn` (which assumes an object) or to `wrap()` (which assumes a wrappable value). The keyed paths now guard every match/key/wrap site, so non-object slots are preserved or replaced wholesale (object→primitive and back).
