---
"@solidjs/signals": patch
---

Fix `affects(store)` hiding concurrent optimistic writes from live tracked readers (#2886). A mark's sentinel put derived nodes (like a `mapArray` over the marked store) into `STATUS_PENDING`, and the read path treated that like real in-flight async — suspending the reader — so an optimistic insert under a whole-store mark never rendered for the duration of the action. Mark-only pending is now value-transparent through derivation: reads whose owner's pending sources are all affects sentinels never suspend, so pendingness reaches readers exclusively through `isPending` verdicts while values keep flowing.
