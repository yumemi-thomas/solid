---
"@solidjs/signals": patch
---

`action()` now awaits yielded object thenables, not just native `Promise` instances. Yielding a Promise-like object that is not `instanceof Promise` (a custom thenable, cache wrapper, or cross-realm promise) previously resumed the generator immediately with the raw object instead of its settled value. Yield handling now uses an object-thenability check (`typeof value === "object" && typeof value.then === "function"`), shared with the async runtime's thenable detection (#2765).
