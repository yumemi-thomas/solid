---
"@solidjs/signals": patch
---

The effect bundle `error` handler is now the error arm of the effect phase (#2840)

Previously the handler fired synchronously mid-propagation, inside an owned
scope — signal writes (the natural "set error state" pattern) tripped
`REACTIVE_WRITE_IN_OWNED_SCOPE`, and it could fire for speculative computes
under a held transition. It now queues like the `effect` function and runs
on the same schedule, in the same imperative writable scope, with the same
throw escalation (nearest boundary, else halt). Consequences: the handler
observes settled outcomes — an error that recovers before the effect phase
runs the `effect` arm instead, and a held transition defers the handler
exactly as it defers `effect`. The no-handler `console.error` fallback moves
to the same schedule. Render effects are unchanged.
