---
"@solidjs/signals": patch
---

Removed the `Loading` queue's notify-through remap. After #2856 narrowed it to fire only while the ERROR dimension was still live in the notification mask, the rule collapsed into the generic consume-and-forward path: each boundary consumes only its own status dimension and forwards the remainder, so an error inside a `Loading` reaches its `Errored` natively. The only residual behavior — suppressing pending collection on a node that is simultaneously pending and errored — is unreachable, as status propagation never sets both dimensions on one node. Added pins for the two paths the remap used to intercept (sync error in the mounting flush and reactive error after commit, both `Errored > Loading > content`).
