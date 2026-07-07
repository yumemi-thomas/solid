---
"@solidjs/signals": patch
---

Redesign isPending/latest companion updates to be write-driven (#2838): verdicts derive from data state and survive transition completion. Fixes the four pinned spec violations — V1 (resting optimistic node reported not-pending while an entangled refetch held its fresh value; the #2799 carve-out is removed since resting nodes never hold revert targets), V2 (an early probe froze latest() at the stale value for the whole blocked window), V3 (isPending read false during a post-transition refetch), and V4 (the latest-form on an untouched optimistic store leaf failed to filter a pure firewall refresh and its companion stuck true forever). Companions now re-derive at settlement checkpoints (commit/revert), firewall status changes poke probed leaf companions, and the resting async hold syncs companions like every other write path.
