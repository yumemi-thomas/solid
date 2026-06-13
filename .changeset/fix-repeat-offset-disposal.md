---
"@solidjs/signals": patch
---

Fix `repeat` (`<Repeat>`) disposing the wrong row owners when `from` advances from a non-zero offset. The front-clear loop indexed the local `_nodes` array with a global index, so a sliding window (e.g. rows 1-3 → 3-5) disposed rows that stayed visible and leaked rows that left. It now disposes the correct local positions.
