---
"@solidjs/signals": patch
---

Fix uncaught errors in async-generator `action()`s freezing the JS thread (#2841)

A rejected iterator-result promise from an async generator means the error
already escaped the generator body (it is completed) — throwing back in via
`it.throw()` just rejected again forever, starving the event loop in a
microtask loop. The runner now settles the action instead: the returned
promise rejects, the iterator is removed from the transition's `_actions`,
and the transition can complete. `try`/`catch` around `yield`/`await` inside
async generators is unaffected, as is the sync-generator throw path.
