---
"@solidjs/web": patch
---

Fix Portal accumulating stale content when its top-level children swap (#2757). Portal previously passed a Proxy of the mount element to `insert`, so dom-expressions' `node.parentNode === parent` ownership checks never matched and old nodes were never removed. Portal now passes the real mount element and host-tags resolved child nodes in the insert accessor, which also covers nodes inserted through `replaceChild` that the Proxy never intercepted.
