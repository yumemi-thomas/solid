---
"@solidjs/signals": patch
---

Document the action naming rationale: actions are the mutation primitive (writes spanning an async gap), navigation is a plain setter call handled by per-node async holding, and framework-level actions (router form actions, server actions) are specializations of this primitive sharing the name deliberately.
