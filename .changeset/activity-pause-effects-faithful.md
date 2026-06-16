---
"@solidjs/signals": patch
"solid-js": patch
"@solidjs/web": patch
---

`<Activity mode="hidden">` now pauses its subtree's effects, matching React.

Previously a hidden `<Activity>` only set `display:none` — effects, timers, and subscriptions inside it kept running. React treats hiding an Activity as a *soft unmount*: it runs the subtree's passive-effect cleanups and stops them while hidden, then re-creates them on show, all while preserving component state and DOM.

Solid now does the same for **user effects** (`createEffect`):

- **On hide:** each `createEffect` in the hidden subtree runs its cleanup (the function returned by its effect callback) and its body stops running — so a `setInterval`/subscription set up in an effect is torn down behind a hidden pane.
- **On show:** the effects re-run, re-establishing their side effects (with the latest reactive values).
- **State + DOM are preserved** — signals keep their values and the DOM is untouched. Render effects (`createRenderEffect`, i.e. DOM bindings) are **not** paused, so a hidden subtree's DOM stays current rather than going stale (a deliberate, safer divergence from React, which defers hidden updates).
- Nested Activities **ref-count** correctly: an inner effect stays paused until every hidden ancestor is shown.

`@solidjs/signals` adds the internal `pauseEffects(owner)` primitive powering this: it pauses every `EFFECT_USER` in an owner's subtree and returns a disposer that resumes exactly those effects (so nesting and a changing subtree can't drift). The only reactivity hot-path change is a single guard in the effect runner (`if (node._paused) return`); tracking, scheduling, and disposal are unchanged.

Two more React-parity behaviors come with this:

- **Mount-hidden runs no effects until first shown.** An effect created inside an already-hidden `<Activity>` doesn't run its body at all until the pane is first revealed (the pause is applied in the render-effect queue before the user-effect queue drains the initial run), matching React deferring hidden content's effects.
- **Revealing/hiding an Activity drives a nested `<ViewTransition>` through enter/exit, not update.** A staying boundary whose box flips zero-area ↔ rendered (because an ancestor `<Activity>` showed/hid it) now fires `onEnter`/`onExit` (with the enter/exit classes), matching React driving Activity visibility flips through enter/exit. In-place geometry changes still fire `update`.

Not matched (documented divergence): React also destroys *layout* effects on hide and renders mount-hidden / SSR content lazily. Solid keeps render effects (DOM) live, and a side effect written directly in a component body (not in a `createEffect`) is not paused — only `createEffect` side effects are, which is the `useEffect` analog.
