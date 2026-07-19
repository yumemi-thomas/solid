---
"@solidjs/signals": patch
---

An ordinary signal write made in the microtask window between one action's completion and its scheduled flush no longer freezes the signal when another action keeps the shared transaction incomplete (#2916). Action `done()` restores the active transition without adopting the ambient batch, so such writes queue in a detached ambient batch; the incomplete-transition stash then replaced that batch wholesale, stranding the queued pending node — the write never committed and every later write to the same signal stayed held (dev INV-7). The stash now only installs a fresh ambient batch when the current batch is the stashed transition itself, and stays scheduled so a kept batch's pending nodes commit on the next drain.
