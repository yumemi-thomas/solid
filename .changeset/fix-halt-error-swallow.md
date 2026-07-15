---
"@solidjs/signals": patch
---

Surface the error that causes `REACTIVITY_HALTED` (#2884). Two fixes: a boundary's foreign-status scrub no longer silently discards an ERROR the queue chain could not deliver to any boundary — the boundary now halts and rethrows exactly like an unhandled effect error (previously an error thrown during initial render under `Loading` + element + `Show` vanished entirely); and `haltReactivity` now logs the causing error alongside the halt message, so the crash cause is visible in the console even when an unwinding layer absorbs the rethrow.
