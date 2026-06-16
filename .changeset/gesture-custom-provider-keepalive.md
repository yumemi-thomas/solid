---
"@solidjs/web": patch
---

Fix gesture View Transitions self-finishing mid-scrub with a custom
`{ currentTime, animate }` provider.

`bindGestureViewTransitionAnimations` added the paused `::view-transition` keep-alive
blocking animation — which stops a transition ending so the gesture can swipe back —
only on the native-`AnimationTimeline` path. A custom provider that did not itself
re-pause every pseudo-element animation each frame (including ones Chrome spawns after
`ready`) let those run to their natural duration and tore the transition down
mid-scrub. The keep-alive is now installed on both paths (parity with React, which adds
it unconditionally), so `commitGesture()` / `cancelGesture()` remain the only things
that end a gesture transition. Covered by new Chromium browser tests.
