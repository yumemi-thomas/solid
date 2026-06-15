---
"@solidjs/signals": patch
---

`flush(fn)` now restores its sync-depth counter when the drain throws. An effect that throws inside a synchronous flush scope previously leaked the counter, which left `schedule()` permanently unable to queue a microtask and silently froze all later reactivity. Balancing it in a `finally` keeps the scheduler usable after the error propagates.
