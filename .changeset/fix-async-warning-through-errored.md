---
"@solidjs/signals": patch
---

Dev: the `ASYNC_OUTSIDE_LOADING_BOUNDARY` warning now fires consistently when a pending async read escapes without a `Loading` ancestor, even under an `Errored` boundary (#2822). Enforcement previously re-notified the boundary chain with an error status, which both suppressed the warning and routed the pending to the error boundary — showing the error fallback in dev only, a dev/prod divergence. Pending is not an error: the mount defers identically in dev and prod, and the diagnostic is informational.
