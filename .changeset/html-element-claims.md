---
"@solidjs/html": patch
---

Wire `claimElement` into the tagged-jsx runtime so anchors and forms with static `href`/`action` in `html` templates reach element-claim consumers (e.g. a router's link-state layer), matching compiled JSX. Dynamic and spread attributes were already claimed through the attribute-write recheck.
