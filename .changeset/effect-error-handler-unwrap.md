---
"@solidjs/signals": patch
---

Fix the effect bundle `error` handler receiving the internal `StatusError` wrapper instead of the thrown error (#2840)

`notifyStatus` wraps compute-phase errors in `StatusError` for source
tracking. `createErrorBoundary` already unwrapped before exposing the error
to its fallback, but `notifyEffectStatus` passed the raw wrapper to the
bundle's `error` handler — breaking `instanceof` and class-based branching
on the documented recovery path. The handler (and the no-handler
`console.error` fallback, and the no-boundary halt rethrow) now receive the
user's original error; the node keeps the wrapper internally for boundary
notification.
