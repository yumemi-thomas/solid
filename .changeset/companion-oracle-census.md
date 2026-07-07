---
"@solidjs/signals": patch
---

Add an opt-in companion-vs-oracle census (test-mode, `COMPANION_CENSUS` env var): a non-asserting diff logger that compares every live isPending/latest companion against a fresh oracle at the end of each flush. Census findings (nine divergence fingerprints, all pending divergences one-directional under-reporting) are recorded in INTERNALS-ASYNC-STATE.md and define the write-driven companion redesign's update points.
