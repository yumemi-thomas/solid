---
"@solidjs/signals": patch
---

Fix optimistic writes of literal `undefined` colliding with the no-override sentinel (#2898). The `_overrideValue` slot doubles as the optimistic-node brand, so storing the raw value erased the node's optimistic identity: the write was invisible to readers, and a follow-up optimistic write was routed off the optimistic path and committed permanently with no rollback at settle. Store deletes, set-to-undefined, and the canonical `filter()` removal shape all funneled into it. Literal `undefined` is now stored as a dedicated `OVERRIDE_UNDEFINED` stand-in (the `NO_SNAPSHOT` pattern) and unwrapped at every site that surfaces the override value — reads, recompute comparisons, `latest()`, verdicts, and store leaf visibility.
