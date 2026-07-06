---
"@solidjs/signals": patch
---

Detach effect cleanups before invoking them so a throwing cleanup is never re-run on later passes and its error takes the standard effect error path (catchable by error boundaries) (#2813)
