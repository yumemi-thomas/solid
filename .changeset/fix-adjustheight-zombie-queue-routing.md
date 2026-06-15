---
"@solidjs/signals": patch
---

Route height-adjusted subscribers to the queue that matches their own zombie flag in `adjustHeight`, mirroring the post-recompute height-adjust path. Inserting into the currently running heap unconditionally could park a zombie node in `dirtyQueue` (or a live node in `zombieQueue`), breaking the flag/queue invariant `deleteFromHeap` relies on — the same corruption class behind the #2759 livelock, reachable through a different trigger.
