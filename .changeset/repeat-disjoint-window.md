---
"@solidjs/signals": patch
---

Fix `repeat()` / `<Repeat>` leaking live row scopes and crashing on disjoint window jumps. When a reactive `from` moves the window to indices that don't overlap the previous window, the shift-and-fill update walked `_nodes` at negative local indices: a forward jump larger than the window created every gap row and left them alive (owners, effects, and `onCleanup`s never disposed), and a backward disjoint jump threw `Cannot read properties of undefined (reading 'dispose')` and froze the list. The first render with a nonzero `from` mapped the whole `0..from+count` prefix for the same reason. Disjoint windows are now detected and replaced wholesale; overlapping slides (the #2784 fix) are unchanged.
