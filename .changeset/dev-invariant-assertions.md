---
"@solidjs/signals": patch
---

Add dev-mode invariant assertions and a spec test suite for the async/transition/lane machinery (probe leaks, companion coherence, override/pending leaks at quiescence, merged-lane routing, out-of-band async-reporter registration). Assertions throw under test, log in dev, and fully tree-shake from production builds. Enabling them surfaced and fixed a real leak: `mergeLanes` copied the merged lane's pending-async set and effect queues into the root without clearing the originals, retaining node references for the lane's lifetime.
