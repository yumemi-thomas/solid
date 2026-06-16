---
"@solidjs/signals": patch
"@solidjs/web": patch
"solid-js": patch
---

Add gesture-driven View Transitions.

`@solidjs/web` — `startGestureTransition(timeline, scope, options?)` runs a scrubbable
View Transition driven by a gesture timeline (a native `AnimationTimeline` such as a
`ScrollTimeline`, or a `{ currentTime, animate }` provider). It returns the usual
`ViewTransitionScope` plus `commitGesture()` / `cancelGesture()` / `finishGesture()`
(which auto-commits or reverts based on whether the timeline passed the range
midpoint). The view-transition pseudo-element animations are rebound to the timeline
with each animation's time-based range mapped onto the gesture range, linear easing,
reversed direction, and a paused keep-alive animation so a `ScrollTimeline` reaching
100% doesn't end the transition early (ported from React's `animateGesture`).
`<ViewTransition>` gains `onGestureEnter` / `onGestureExit` / `onGestureShare` /
`onGestureUpdate` callbacks; concurrent gestures sharing a provider are ref-counted;
and a layout is forced before the transition (Safari clone workaround).

`@solidjs/signals` (re-exported from `solid-js`) — `startGestureTransaction(scope)`
runs a scope as a transaction: every signal/store write is recorded so the gesture can
`commit()` (keep) or `cancel()` (roll back) the changes. Render effects run during the
scope so the DOM updates for the snapshot, but **user effects are deferred** — they run
once on `commit()` (against the committed state) and are dropped on `cancel()`, so a
cancelled gesture fires no side effects (matching React, while still allowing arbitrary
writes in the scope).

The gesture preview is **mutate-and-revert**, not React's non-committing clone preview:
Solid has a single live reactive state with no alternate tree, so the destination is
computed by running the scope against the live DOM. For non-structural changes (tabs,
routes, reorders, attribute/style/text updates — the common case) this is equivalent to
React. For structural branch replacements it disposes and recreates nodes, so live
interactive state (focus, scroll, `<video>` playback, third-party widgets) on the
*replaced* content is not preserved across the gesture; `captureInteractionState`
recovers it for surviving/moved nodes. This divergence and its rationale are documented
in `packages/solid-web/VIEW_TRANSITIONS.md` and covered by tests.
