---
"@solidjs/web": patch
---

Rewrite `Portal` mounting: pass the real mount element to `insert` with the new `host` option instead of a `Proxy` wrapper, and run the insert in an owner-parented root that is disposed on mount change or Portal disposal. Fixes portal content accumulating on keyed swaps (#2757), `NO_OWNER_EFFECT` leaks from scheduled portal effects (#2758), and event retargeting for nodes inserted through replace paths.
