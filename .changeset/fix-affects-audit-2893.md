---
"@solidjs/signals": patch
---

Fix the four affects() audit bugs (#2893): the pending-source container no longer corrupts at three overlapping sources (isPending stuck true forever after a keyless store mark over mapArray), mark propagation no longer captures downstream subscribers into the marking action's transaction (plain writes to marked or graph-adjacent unmarked signals froze until the action settled), mark pendingness now survives recomputation transitively past one derivation level (including the recompute the isPending probe itself triggers), and a memo's real error is no longer clobbered by a mark sentinel's NotReadyError.
