---
"@solidjs/signals": patch
---

Fix dev/prod divergence of `isPending()` on uninitialized async sources in component bodies (#2928): the dev component-body safeguard threw a plain Error inside the probe, which `isPending` swallowed, returning `false` where production propagates `NotReadyError`. Probe reads now follow the production path in both builds.
