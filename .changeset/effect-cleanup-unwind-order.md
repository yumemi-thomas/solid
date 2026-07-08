---
"@solidjs/signals": patch
---

Effect-returned cleanups now fire at the effect node's own disposal (unwind order) instead of via a hook registered on the parent's disposal list. Removes a retention edge — early-disposed effects no longer leave dead closures in the parent's disposal array — and makes final effect cleanup ordering identical between dev and prod through the dev component wrapper.
