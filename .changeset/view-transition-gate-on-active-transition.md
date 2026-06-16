---
"@solidjs/web": patch
---

`<ViewTransition>` now fires view-transition events **only when the DOM change commits inside a transition** — matching React.

Previously, any reactive (or third-party structural) DOM change inside a `<ViewTransition>` boundary triggered a view transition. A bare `setInterval(() => setSignal(n => n + 1))` updating a text node inside the boundary fired a browser transition **every tick** ("firing like crazy"), and mounting/unmounting a boundary always animated regardless of how the change was committed.

This now matches React's experimental `<ViewTransition>`, which drives a commit through `startViewTransition` only when the committing lanes are view-transition-eligible (`includesOnlyViewTransitionEligibleLanes` — transition / Suspense-retry / idle lanes); a plain `setState` (DefaultLane) mutates the DOM with **no** animation. Solid's analog: the change must commit inside a `startViewTransition` scope (which routers, app transitions, and gestures all route through). The gate is applied **uniformly** to `enter`, `exit`, `update`, and `share`, exactly as React applies it.

**Behavior change (opt-in required):**

- A reactive write inside a boundary **outside** any `startViewTransition` no longer animates — `onUpdate` does not fire and no browser transition starts. Wrap the update in `startViewTransition(() => …)` to animate it.
- **Mounting** a `<ViewTransition>` outside a transition no longer fires `onEnter` (including the initial render — first paint never animates, matching React).
- **Unmounting** a `<ViewTransition>` outside a transition no longer fires `onExit`, and same-name replacements no longer pair as `onShare`, unless the mount/unmount commits inside a transition.

Implementation: the active-transition scope is **captured synchronously** at the moment a DOM change is detected (`captureViewTransitionContext`, returning `undefined` when no transition is active) and threaded through the deferred lifecycle microtasks (the update microtask, the exit batch, the enter/share pairing), because the module-level scope is restored before they run. The fallback that spawned a fresh browser transition for any spontaneous mutation is removed.

The existing protection against third-party `setAttribute`/`data-*`/`aria-*` noise (the `isReactiveFlushActive()` gate) is unchanged and now strictly subsumed: those writes were already ignored, and would in any case never carry an active transition.

**`update` is now geometry-driven, matching React.** Update detection no longer monkey-patches `Node.prototype` mutators / `setAttribute` / `classList` / `style` to observe reactive DOM writes. Instead, around a transition's flush the boundary's host-element rects are measured before and after (`snapshotViewTransitionRects`/`fireViewTransitionUpdates`), and `update` fires only when the geometry actually changed — React's `hasInstanceChanged` (x/y/width/height delta). This:
- skips a no-op `update` for a content/class/style change that doesn't alter the box (React cancels those), and
- catches a **pure layout shift** — a boundary that moves because a sibling resized, with no DOM mutation of its own — which the old mutation-driven detection missed entirely.

It also lets the entire prototype-patching subsystem (and its third-party-`setAttribute`-noise gating) be **deleted**. The compiler-emitted DOM helpers (`insert`, `spread`, `setProperty`, `setAttribute`, `className`, `style`, …) are once again the plain `dom-expressions` implementations.

**Viewport guard:** also matching React (`wasInstanceInViewport`), a boundary whose host elements are all outside the viewport no longer fires its callback or applies its styled transition class. The intersection test is React's exact math (`rect.bottom >= 0 && rect.right >= 0 && rect.top <= innerHeight && rect.left <= innerWidth`).

Because jsdom has no layout engine, geometry-driven update is verified in the real-browser suite (`test/browser/viewtransition-react-parity.browser.spec.tsx` — resize fires, fixed-size content change doesn't, pure layout shift fires); the jsdom suite mocks `getBoundingClientRect` (width from text length) to keep deterministic coverage.

One React behavior remains deliberately unmatched (documented in `VIEW_TRANSITIONS.md`): the `display:inline → inline-block` WebKit workaround is not ported — Solid runs the boundary lifecycle before `<Show>`/`<For>` insert the nodes, so the element is detached at `enter` and `getComputedStyle` is unavailable. Wrap inline content in a block-level element if you hit the WebKit bug.
