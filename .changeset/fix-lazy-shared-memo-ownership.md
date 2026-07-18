---
"solid-js": patch
---

Fix `lazy()` stranding surviving instances when the first in-flight instance is disposed (#2915). The memo tracking the shared import was owned by whichever instance rendered first; disposing that instance killed the memo and survivors never saw the module resolve. The import promise stays shared (still fetched once), but each in-flight instance now owns its own tracking memo.
