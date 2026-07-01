---
"@solidjs/signals": patch
---

Fix infinite loop when an async memo is read inside `Loading > Errored` (#2809). Boundaries no longer re-throw a foreign status (pending through an `Errored`, errors through a `Loading`) to reactive readers; the status is propagated exclusively through the boundary queue chain to whichever boundary handles it. Boundary trees notify both status dimensions like render effects do, foreign flags are cleared from the tree's reader-visible state, and boundary result computeds are excluded from hydration snapshot capture (they previously relied on the leaked pending flag to be skipped).
