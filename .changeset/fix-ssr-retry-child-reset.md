---
"solid-js": patch
---

Fix SSR async retry paths re-running computes without resetting owner child state (#2900). The client disposes children and resets the child-id counter on every recompute; on the server only `createSyncMemo` did. Every other retry path — serverEffect retries, async `createMemo` reruns, `createProjection` reruns, and `disposeOwner`'s leaf fast path hit by the Loading discovery retry — kept allocating child hydration ids where the failed run left off, drifting the successful run's ids past the client's so serialized values and DOM nodes hydrated under the wrong keys. Retries now reset child state first (failed runs' onCleanups fire at retry instead of leaking to root disposal), with the retrying primitives' lifecycle cleanups moved to the creation context so a retry can't cancel itself.
