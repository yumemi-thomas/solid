---
"@solidjs/signals": patch
---

Reset `<Repeat>`'s window offset when its count drops to zero. Previously the empty-window path cleared the row data but left `_offset` stale, so a later nonzero render with a smaller `from` computed a negative local index and disposed `_nodes[-1]`, crashing `updateRepeat`. This is the second symptom of #2767 (the first, wrong-row disposal on a forward slide, was fixed separately).
