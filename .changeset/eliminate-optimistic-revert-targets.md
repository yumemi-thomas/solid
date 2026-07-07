---
"@solidjs/signals": patch
---

Eliminate optimistic revert targets: `_pendingValue` now has exactly one meaning (a pending commit) and `_value` changes only at commit points. Authoritative values arriving under an active override hold like any other transition write and elevate on their own transition's schedule — unobservably, since every reader sees the override (A17); reverting an override is a pure drop that commits nothing. Fixes a data-loss bug (V5) where a first optimistic write clobbered a refetch value held in the blocked-merged window, resurrecting stale data at revert. Refines A18 (2026-07-07b re-rule): an override's lifetime is bound to its own transition; in merged transitions corrections reveal atomically with the merged completion (pending true throughout) while still propagating internally on arrival — no waterfalls, only the reveal is gated.
