---
"@solidjs/signals": patch
---

Errors thrown by a user `equals` comparator now route through the node's error status like compute-phase throws, so error boundaries contain them (previously they unwound the scheduler flush, bypassing every boundary and silently wedging the queue). Applies to sync recompute, direct writes during async resolution, and lane-routed async writes. Also documented the createEffect error contract: the `EffectBundle.error` handler intercepts compute-phase (reactivity) errors only; effect-phase throws are the user's own imperative code and escalate to the nearest error boundary (#2837, #2839).
