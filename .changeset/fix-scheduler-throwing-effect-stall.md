---
"@solidjs/signals": patch
---

Fix one throwing effect killing all reactivity (#2761, #2762). An unhandled effect error no longer unwinds the flush: sibling effects queued behind it still run, and a write during the failed flush can no longer permanently stall scheduling. Errors are collected and rethrown from `flush()` once the drain completes; when several effects throw in one drain, the first is rethrown and the rest are reported via `console.error`.
