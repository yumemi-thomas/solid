---
"@solidjs/signals": patch
---

reconcile() now reaches captured proxies with live subscribers through untracked intermediate levels: node presence bubbles a sticky flag up the wrap chain and the object diff follows it, while never-subscribed branches keep the wholesale identity-swap prune (#2902)
