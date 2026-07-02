---
"@solidjs/signals": patch
---

Fix a throwing effect cleanup permanently breaking its effect (#2813). The previous cleanup is detached before it runs, so a cleanup that throws is never re-invoked on later runs and the effect recovers on the next update. Cleanup errors now take the standard effect error path: error boundaries can catch them, and the dev-mode strict-read guard is restored instead of leaking `STRICT_READ_UNTRACKED` false positives app-wide.
