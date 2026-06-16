# View Transitions: parity with React + known differences

`@solidjs/web` ships a `<ViewTransition>` component and `startViewTransition` /
`startGestureTransition` helpers modelled on React's experimental
`<ViewTransition>` / `addTransitionType` / gesture APIs. This document records
where Solid matches React and the one place it deliberately diverges, with the
rationale, so the gap is documented rather than mistaken for a bug.

## Capability parity (matches React)

- **Lifecycle:** `enter`, `exit`, `share`, `update` transitions with
  `onEnter` / `onExit` / `onShare` / `onUpdate` callbacks, and the gesture
  variants `onGestureEnter` / `onGestureExit` / `onGestureShare` /
  `onGestureUpdate`.
- **Transition-gated, like React:** a view transition fires **only when the DOM
  change commits inside a transition** — i.e. inside a `startViewTransition`
  scope (which routers, app transitions, and gestures route through). A plain
  reactive write outside a transition mutates the DOM with **no** animation;
  mounting or unmounting a boundary outside a transition is silent. This mirrors
  React, where only view-transition-eligible lanes
  (`includesOnlyViewTransitionEligibleLanes` — transition / Suspense-retry /
  idle) drive `startViewTransition`, and a plain `setState` (DefaultLane) never
  does. The gate is applied uniformly to enter / exit / update / share. See
  [Opting in to update transitions](#opting-in-to-update-transitions).
- **Same-name pairing:** an exiting boundary and an entering boundary with the
  same `name` are paired into a single *share* within the commit window
  (tracked via `appearingViewTransitions` + `liveViewTransitionNames`,
  order-independent).
- **Nesting:** nested shares pair independently; nested exits are subsumed so
  only the outermost boundary fires `onExit` (matching React's
  `commitExitViewTransitions` / `if (pairs.size === 0) break` behaviour).
- **Transition types:** `addTransitionType(...)` is mirrored to the native
  `ViewTransition.types`, so `:active-view-transition-type(...)` CSS works, and
  types are passed to every callback.
- **Class resolution:** `default` / `enter` / `exit` / `share` / `update`
  class props resolve per phase, including the object form
  (`{ <type>: "class", default: "class" }`).
- **Gesture animation binding:** view-transition pseudo-element animations are
  rebound to a gesture timeline (a native `AnimationTimeline` such as a
  `ScrollTimeline`, or a `{ currentTime, animate }` provider), with each
  animation's time-based range mapped onto the gesture range, linear easing,
  reversed direction, and a paused keep-alive animation so a `ScrollTimeline`
  reaching 100% does not end the transition early — a port of React's
  `animateGesture`.
- **Transaction semantics:** `startGestureTransaction(scope)` records every
  signal/store write so the gesture can `commit()` (keep) or `cancel()` (roll
  back). Render effects run during the scope so the DOM reaches the destination
  for the snapshot, while **user effects are deferred** — run once on `commit()`
  against the committed state, dropped on `cancel()`. A cancelled gesture fires
  no side effects, matching React.

## `update` is geometry-driven (matches React)

`update` fires off **geometry**, not DOM-write observation. Around a transition's
flush, Solid measures each boundary's host-element rects before and after and
fires `update` only when the position/size changed — React's `hasInstanceChanged`
(x/y/width/height). So:

- a content / class / style change that doesn't alter the box does **not** fire
  `update` (React cancels those), and
- a **pure layout shift** — a boundary that moves because a sibling resized,
  with no DOM change of its own — **does** fire `update`.

(Earlier builds instead monkey-patched DOM mutators to fire on any reactive write
inside the boundary; that subsystem is gone.) React's **viewport guard** is also
matched: a boundary entirely outside the viewport does not animate or fire.

## Known minor divergence from React (declarative)

One narrow React behavior is deliberately not matched (beyond the gesture-preview
gap below):

- **No `display:inline` workaround.** React promotes a single-rect `display:inline` boundary element to `inline-block` for the transition (a WebKit bug workaround for inline elements with block children). Solid runs the boundary lifecycle before `<Show>`/`<For>` insert the nodes, so the element is detached at `enter` and computed style is unavailable — the workaround can't be applied reliably. Wrap inline content in a block-level element if you hit the WebKit issue.

## Opting in to update transitions

A `<ViewTransition>` does **not** animate just because its content changed. A
reactive write that happens outside a transition updates the DOM with no
animation — including a timer ticking inside the boundary:

```tsx
// No animation: a plain reactive write is not a transition (like React's
// DefaultLane `setState`). The text updates silently.
setInterval(() => setCount(c => c + 1), 1000);

<ViewTransition name="counter" onUpdate={onUpdate}>
  <span>{count()}</span> {/* updates every second, fires 0 transitions */}
</ViewTransition>;
```

To animate a change, commit it inside a transition. `onUpdate` then fires once
and the boundary rides on that transition (it does not open a second one):

```tsx
startViewTransition(() => setCount(c => c + 1)); // animates once
```

Routers and `startGestureTransition` route through `startViewTransition`, so
navigations and gestures animate as expected. The same rule applies to
`enter` / `exit` / `share`: mounting or unmounting a boundary animates only when
the mount/unmount commits inside a transition. The initial render is never a
transition, so first paint never animates — matching React.

> **Why this changed.** Earlier builds fired an update transition on *any* DOM
> mutation inside a boundary, so a `setInterval` re-render animated every tick.
> That diverged from React; the behavior is now transition-gated to match.

## The one divergence: the gesture *preview* model

> **Summary.** React runs a gesture as a **non-committing preview**: the live
> interactive DOM stays at the **current** state during the scrub, and a cancel
> is a true no-op. Solid runs a gesture as **mutate-and-revert**: the live DOM
> is moved to the destination to produce the snapshot, and reverted on cancel.
> For **structural** changes this disposes and recreates nodes, so live
> interactive state on the *replaced* content is not preserved across the
> gesture. This cannot be closed by porting React's clone-preview.

### Why React can keep the live tree current

React renders a gesture against an **alternate fiber tree** (`finishedWork`)
that is fully rendered but **never committed**. Destination DOM is produced as
*static clones* (new host nodes for insertions; `cloneNode` + `commitUpdate` on
the delta for updates). The browser's "before" snapshot is taken of those
clones; the "after" snapshot of the live tree (with names applied); then the
clones are removed and the UA animations are rebound to the gesture timeline.
Crucially, React **never disposes the committed host instances** to compute the
destination — so the live, interactive content underneath the scrub is
untouched, and a cancel discards the never-committed work.

### Why Solid cannot mirror this

Solid has **one live reactive state and no alternate tree**. The only way to
compute the destination is to run the reactive scope, whose render effects are
bound to the *live* DOM nodes (they close over specific `Node` references — you
cannot redirect a reactive update to render into clones). For a **structural**
change — a keyed `<Show>`/`<For>`/`<Switch>` branch swap, an `<Activity>`
toggle that unmounts — running the scope **disposes** the current branch. The
gesture transaction then reverts the signals, which **recreates** that branch as
*fresh nodes*.

Every clone orchestration runs into the same wall:

| Orchestration | Live tree during scrub | Result for a replaced branch |
| --- | --- | --- |
| mutate → clone destination → revert | current | original already disposed by the mutate; revert builds fresh nodes |
| clone current → mutate → keep destination live | destination | original disposed by the mutate (Solid's pre-existing behaviour) |
| keep both trees live | — | impossible: one reactive state; the destination is the reactive product of the same signal |

Cloning can capture destination *pixels* for a faithful snapshot, but it cannot
preserve the live node **identity/state** of replaced content, because the
disposal happens *while computing the destination*, before any clone could
stand in. This is proven by a node-identity test (below): after a cancelled
gesture over a keyed branch swap, the restored node is a new element and the
original's value/focus/scroll is gone.

### User-visible impact

Affected only for content that is **structurally replaced** during a gesture and
carries live state — e.g. a `<video>` (playback restarts), a focused
`<input>`/caret (focus lost), a scrolled container (scroll resets), or a
third-party widget (re-initialises). Cancel can show a brief "snap".

**Not affected:** tabs, routes, list reorders, and any attribute/style/text/
class update — these *move* or *update* nodes rather than disposing them, so
node identity is preserved. This is the large majority of real transitions.

### Mitigation that ships today

`captureInteractionState` (in `src/index.ts`) has two layers.

**1. Identity layer (automatic).** Snapshots the focused element + caret/selection,
and (for non-`ScrollTimeline` gestures) the scroll offsets of the focused element's
scrolled ancestors, then re-asserts them on the scrub frame and after commit/cancel.
It recovers the casualties for nodes that **survive** the transition (a
reparented/moved keyed row), never steals focus the app moved elsewhere, and no-ops
for nodes the transition removes (no surviving node to restore to).

**2. Serializable layer (opt-in via `data-vt-preserve`).** Mark an element
`data-vt-preserve="<key>"` and its serializable live state is snapshotted before the
mutate and re-asserted on the **commit/cancel reveal** (not mid-scrub — the live DOM is
hidden under the snapshot there, so restoring then would only fight a legitimate
gesture change). Captured state: media `currentTime` / `paused` / `playbackRate`,
`<details>`/`<dialog>` `open`, form `value` / `checked`, and scroll offset. For a
**structurally-replaced** branch the original node is disposed and recreated; on
**cancel** the captured state is matched to the recreated element by its `<key>`, so
serializable state the identity layer cannot recover (the node is gone) comes back —
e.g. an uncontrolled `<input data-vt-preserve="note">` keeps the user's text, a
`<video data-vt-preserve="hero">` keeps its position/rate, a scrolled list keeps its
offset. The key is app-authored and explicit, so this is a contract, not a fragile
positional heuristic. It still **cannot** recover **non-serializable** state (a live
`MediaStream`/WebRTC `<video>`, a WebGL/WebGPU context, iframe internals) — that needs
node-identity preservation (the deferred-disposal / offscreen-render direction below).

## Tests

- `test/view-transition.spec.tsx` →
  `describe("gesture preview: documented divergence from React")`:
  - *a structurally-replaced branch is disposed and recreated across a cancelled
    gesture* — encodes the limit (restored node ≠ original; value lost).
  - *a reordered (surviving) node keeps its identity through a gesture round
    trip* — encodes the boundary (moved nodes keep identity; the recoverable
    case the mitigation targets).
- Capability-parity behaviour (callbacks, pairing, types, ref-counting,
  retain/skip) is covered by the surrounding gesture tests in the same file.
- **Automated real-browser tests** run in Chromium via Vitest browser mode:
  `test/browser/gesture.browser.spec.tsx` (`pnpm --filter @solidjs/web test:browser`,
  config `vite.config.browser.mjs`). They assert the divergence (live tree at the
  destination during a scrub; cancel recreates a fresh node), the mitigation
  (a moved keyed row keeps node identity + caret), the commit/cancel
  finalisation fix (no leftover pseudo animations or `::view-transition`
  overlay), and that transition types reach `:active-view-transition-type()` CSS.
  These exercise the behaviour the jsdom suite mocks away; they run against the
  built `dist` (so `build` first) and the script clears the `.vite` dep cache so
  a rebuild is always picked up.
- `test/browser/viewtransition-dupname.browser.spec.tsx` checks that the dev
  duplicate-name warning does not false-positive on same-name *shares* or keyed
  tab switches (only a genuinely duplicated live mount warns). Because Vitest
  fails the run on any unhandled rejection, these transition-heavy tests also
  guard that `startBrowserViewTransition` defuses the `ready`/`finished`
  AbortError a skipped/superseded transition rejects with (otherwise visible as
  "Transition was skipped" console noise).
- A **manual** real-browser harness lives in `examples/view-transition-tabs`
  (the *Gesture Scrub* tab): an interactive scrubbable gesture over a
  structurally-replaced panel (playing `<video>` + focused `<input>` + scrolled
  container) and a reorder panel, with a `window.__gesture` probe for scripted
  inspection. jsdom cannot stand in for either (no layout, mocked
  `startViewTransition`).

## Empirical validation in a real browser (Chrome 149)

jsdom mocks `document.startViewTransition` (its `finished` resolves
synchronously, there are no pseudo-element animations and no layout), so the
divergence and its mitigation can only be *proven* in a real browser. The
interactive harness in `examples/view-transition-tabs` (the **Gesture Scrub**
tab) was driven in Chrome with a pointer-style `{ currentTime, animate }`
provider that pauses each view-transition pseudo animation and parks it at the
scrub fraction. Two panels are scrubbed: **A** a structurally-replaced keyed
`<Show>` branch holding a *playing* `<video>` (canvas `captureStream`, a frame
counter drawn into the pixels), a focused `<input>` with a caret, and a scrolled
list; **B** a `<For>` reorder. Each mount carries a unique id so node identity is
observable. Results:

- **The live tree is at the destination during a scrub (confirms the
  divergence).** Held at 50%, the live DOM under the snapshot was the
  destination panel — a *new* mount id, an empty input, scroll reset to 0, a
  fresh video at frame ~30, focus dropped to `<body>`. React keeps the live tree
  at the *current* state; Solid does not.
- **Cancel of the structural panel loses live state (confirms the casualties).**
  After `cancelGesture()` the signal reverted (`page` back to A) but the panel
  came back as a **new mount id** (original disposed, not restored): the input
  was empty (caret text gone), the scroll was 0 (was 180), the video had
  restarted (`currentTime → 0`), and focus was on `<body>`. The mitigation
  correctly *does not* fire here — the original focused node was removed, so
  there is nothing to restore to.
- **Cancel of the reorder panel is clean (confirms "unaffected").** The focused
  row's `<input>` was the **same node** before, during and after the gesture
  (verified by an object stamp); its value was preserved; focus + caret were
  re-asserted; and no view-transition pseudos leaked (`cancelGesture()` calls
  `skipTransition()`).
- **The mitigation recovers a surviving/moved row (confirms
  `captureInteractionState`).** Focusing a reorder row's input, then scrubbing
  the reverse that moves it, kept focus and caret on the moved node both during
  the scrub (re-asserted on `ready`) and after cancel/commit.
- **Transition types reach the native API and CSS for gestures.** During a live
  gesture the native `ViewTransition.types` held `["gesture", "structural"]` and
  `:root:active-view-transition-type(gesture)` matched in CSS — parity with the
  non-gesture path.

### Newly-found edge cases (real browser only)

These were surfaced by the real-browser harness and are invisible to the jsdom
suite. They do **not** change the divergence above.

1. **`commitGesture()` leaking the browser transition — FIXED.** Originally
   `commitGesture()` only committed the signal transaction and never ended the
   browser transition (only `cancelGesture()` called `transition.skipTransition()`).
   A scrubbable provider necessarily *pauses* the view-transition pseudo
   animations to hold the scrub, and a paused animation's `finished` never
   resolves — so after commit the full-page `::view-transition` snapshot and its
   paused animations persisted **indefinitely** (measured >5s, cleared only when
   the next transition superseded them), burying the live destination under a
   frozen overlay. jsdom never surfaced it (its mocked `finished` resolves
   synchronously). The fix makes `release()` call `transition.skipTransition()`
   on **commit as well as cancel** — ending the transition at the current live
   DOM, which the transaction has already set to the destination (commit) or
   rolled back to the origin (cancel). Covered by the browser test *commit
   releases the paused snapshot* and the updated unit test *commits gesture
   signal writes past the timeline midpoint* (now asserts commit finalises via
   `skipTransition`).
2. **A fully-paused scrub still matches `:active-view-transition-type()` — CORRECTED.**
   An earlier note here claimed a fully-paused scrub stops matching the selector.
   An isolated real-browser probe (Chrome 149, raw `startViewTransition` + WAAPI)
   refutes that: paused `::view-transition` pseudo animations **keep matching**
   `:active-view-transition-type(...)` — confirmed with *and* without the keep-alive
   blocker, at scrub fractions 0 / 0.01 / 0.5 / 0.9 / 0.99 (5/5). A `ScrollTimeline`-
   driven gesture matches too. The earlier "no match" observation was almost
   certainly the *transition having already ended* (see #3), not paused animations
   failing to match. Locked in by the browser test *`:active-view-transition-type()`
   matches even while the scrub is fully paused*.
3. **Custom `{ currentTime, animate }` providers lacked a keep-alive — FIXED.**
   `bindGestureViewTransitionAnimations` added the paused `::view-transition`
   blocking animation (which stops a transition self-finishing so the gesture can
   swipe back) **only on the native-`AnimationTimeline` path**; the custom-provider
   path returned early without it. React adds the keep-alive *unconditionally*, so a
   custom provider that did not itself re-pause every pseudo animation each frame —
   including ones Chrome spawns *after* `ready` — let those run to their natural
   ~250ms and **tear the transition down mid-scrub**. The fix extracts an
   `addKeepAlive()` and calls it on **both** paths. Covered by the browser tests
   *a custom provider that drives but does not pause keeps the transition open past
   the default duration* and *a custom-provider gesture installs a paused
   `::view-transition` keep-alive*.

## If you want to revisit a clone-preview port

A *full, automatic* port — matching React's non-committing preview for every
control-flow boundary — would require giving Solid a way to render a scope into a
**detached/alternate node set** without disposing the live tree (an "offscreen
render" primitive in `@solidjs/web` + dom-expressions), so the destination could be
produced as React produces `finishedWork`. That is an RFC-scale change to the
renderer, not a gesture patch, and must be validated in a **real browser** (jsdom has
no layout and a mocked `startViewTransition`, so it cannot validate clone snapshots or
scrub timing).

### `UnstableKeepAlive`: deferred-disposal keepAlive (shipped, opt-in)

There is a cheaper middle ground that preserves node **identity** (and therefore
*all* state, including the non-serializable tail `data-vt-preserve` can't reach)
without an offscreen primitive: **don't dispose the outgoing branch during a gesture —
detach and retain it, then reattach the same nodes on cancel.** This is the
`<Activity>` idea (retain owner + DOM without disposing) applied to a gesture, and it
ships as `UnstableKeepAlive`:

```tsx
import { UnstableKeepAlive } from "@solidjs/web";

<UnstableKeepAlive key={page()}>{p => <Panel variant={p} />}</UnstableKeepAlive>
```

The name is capitalized so it works directly as a JSX component, while the `Unstable`
prefix keeps its experimental status explicit (alias it to something shorter if you
like — `import { UnstableKeepAlive as KeepAlive }`). It's exported from both the client
and server builds; on the server it renders the current branch like a keyed `<Show>`
(no gesture machinery).

A drop-in for a keyed `<Show>`. **Outside a gesture** it disposes the outgoing branch
immediately (like `<Show keyed>` — no retention, no leak). **During a gesture** it keeps
the outgoing branch's owner live and its nodes off-document, so `cancelGesture()`
reattaches the *same* node; retained branches are disposed once the gesture settles
(commit keeps the destination, cancel keeps the origin). It auto-detects the gesture
lifecycle via an internal hook in `startGestureTransition` (a ref-counted active flag +
a settle notification) — no `active` prop needed. Real-browser tests
(`test/browser/gesture.browser.spec.tsx` → *"UnstableKeepAlive (identity
preservation)"*) prove a cancelled structural gesture restores the same node with a JS
object reference still on it (non-serializable state survives), preserves focus/caret,
behaves like keyed `<Show>` outside a gesture, stays memory-bounded, and that commit
disposes the retained branch.

Tradeoffs (why it's `unstable_` and opt-in): the app must use it instead of
`<Show>`/`<For>` where identity matters; a retained branch keeps its effects/timers
running while detached; and its state persists for the duration of the gesture. Making
retention **automatic** for existing control flow stays RFC-scale — the gesture
transaction reverts by re-running computations (`recompute`), which rebuild branches
fresh, and DOM reconciliation is render-effect-driven and independent of owner
disposal, so automatic deferral needs coordinated core + dom-expressions changes. See
`RFC-gesture-keepalive.md` for the design and the future `keepAlive`-prop / automatic
directions.
