---
"@solidjs/signals": patch
---

A resting `createOptimistic` async source (no active override) now commits its async completion through the same pending-node commit path as a plain async memo, instead of writing its value directly. The direct write skipped the commit that clears `STATUS_UNINITIALIZED`, so when `isPending(() => data())` was the *only* consumer (the `disabled={isPending(data)}` shape, with no value-observer to drive the commit), the flag was never cleared and the first `refresh()` was misread as an initial load — `isPending` never reported `true`. Routing the resting completion through the shared commit makes a resting optimistic node indistinguishable from a non-optimistic one, removing the divergence rather than special-casing it.
