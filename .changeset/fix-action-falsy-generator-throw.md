---
"@solidjs/signals": patch
---

Reject actions correctly when generators throw falsy values. `done` distinguished resolve from reject by the truthiness of the error argument, so `throw undefined` / `throw 0` / `throw ""` inside an action generator resolved the returned promise instead of rejecting it. An explicit `failed` flag now carries the settle disposition.
