---
"@solidjs/signals": patch
---

Surface synchronously-rejecting thenables. A memo returning a Promise-like thenable that invoked its rejection handler synchronously during `.then()` (e.g. a cache that already knows it failed) had its error dropped and stayed stuck on the pending path forever — `<Loading>` never gave way to `<Errored>`. The thenable branch now captures a synchronous rejection (mirroring the existing sync-resolve handling) and settles it, so the error reaches the boundary the same way an async rejection does (#2764).
