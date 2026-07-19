---
"@solidjs/signals": patch
---

Yielding a thenable whose `then` getter or `then()` method throws synchronously no longer leaks the action's iterator in its transaction (#2918). Assimilation failures now match `await` semantics: the error is thrown back into the generator at the yield point (catchable there); if uncaught, the action settles through its normal rejection path, the iterator is removed from the transition, and plain writes made before the yield commit. Previously the exception escaped the Promise executor — the returned promise rejected, but the transition stayed incomplete forever and every write to the affected signals was permanently held.
