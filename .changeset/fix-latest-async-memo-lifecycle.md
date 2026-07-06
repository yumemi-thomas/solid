---
"@solidjs/signals": patch
---

Fix `latest()` / `isPending(() => latest(x))` on async memos (#2829). Three related defects in the latest-shadow computed's lifecycle: (1) after the initial load resolved, `latest(x)` regressed to `undefined` because the shadow recomputed mid-transition under a stale/lane read context and cached the committed (still-undefined) value; (2) the first refresh after settling never reported pending because the shadow stayed `STATUS_UNINITIALIZED` forever (the optimistic-node resolution path committed its first value without clearing the flag), so the pending probe mis-classified the refresh as an initial load and suspended the reader before collecting pending sources; (3) `latest()` now never suspends a reader once the source has a value — it falls back to the stale committed value, and only suspends on a true initial load where there is nothing stale to show.
