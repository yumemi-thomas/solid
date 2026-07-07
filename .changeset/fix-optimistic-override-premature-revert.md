---
"@solidjs/signals": patch
---

Fix optimistic overrides being silently dropped when their transition is entangled with other async work. `transitionComplete` excluded a node pending on its own fetch from blocking completion, so a merged transition could complete on the first flush and revert the override while its async was still in flight. An active override is now held for every reader (ambient and tracked) until the owning transition truly settles (ruled as spec A17).
