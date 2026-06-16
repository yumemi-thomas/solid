---
"@solidjs/signals": patch
"@solidjs/web": patch
"solid-js": patch
---

Detect compiled reactive `class`/`style` changes as `<ViewTransition>` updates, and run the view-transition lifecycle during gesture transitions.

`@solidjs/web` — Reactive class and style writes from compiled JSX now trigger an
update transition on a staying element: object class (`class={{…}}`, compiled to a
native `el.classList.toggle(…)` with no Solid helper to wrap), string class
(`class={cls()}`), inline `style` objects (`style.setProperty`), string `style`
(`style.cssText`), `innerHTML`, and reactive attributes. Detection extends
`patchViewTransitionDOMTracking` to patch `Element.prototype.setAttribute`/
`removeAttribute`/`innerHTML`, `DOMTokenList` (add/remove/toggle/replace), and
`CSSStyleDeclaration` (setProperty/removeProperty/cssText) — owner-stamped via the
`classList`/`style` getters since those objects have no back-reference to their
element. Every patch is **gated on an active reactive flush**, so Solid's writes (which
always run inside an effect flush) are detected while asynchronous third-party writes
(browser extensions stamping `data-*`/`aria-*`) are ignored — no feedback loop.

`<ViewTransition>` now assigns view-transition names, registers elements, and fires
enter/exit/share from a **render effect** rather than a user effect. This is
mutation-phase work that must run as the subtree mounts — including inside a gesture
transaction, where user effects are deferred — so `onGestureEnter`/`onGestureShare`
fire during the gesture (matching React, where view-transition setup is decoupled from
passive-effect commit). Same-name enter/share pairing is resolved within the flush and
is order-independent: the appearing element is tracked first and a departing same-name
element claims it as a share, so a replacement animates as a share regardless of mount/
unmount ordering. A fresh mount still fires enter synchronously, so common-case timing
is unchanged.

Nested boundaries now match React: nested same-name replacements pair as **independent
shares** (a parent share does not subsume nested ones), while nested exits are
**subsumed** — when an ancestor `<ViewTransition>` is also leaving in the same flush,
only the outermost fires `onExit` (nested unmatched boundaries ride under the ancestor's
exit). Same-flush exits are batched one microtask so ancestor/descendant relationships
are known before any event fires; unrelated (non-nested) boundaries removed together
still each fire their own exit.

Gestures now **preserve focus and the text caret** across the transition. Solid can't
use React's clone-preview (its reactive graph is bound to the live DOM nodes the browser
snapshots, so the destination state is produced by mutating the real tree), and
reparenting/reordering a focused field — e.g. a keyed `<For>` row with an `<input>` —
blurs it. `startGestureTransition` snapshots the active element + selection (and the scroll
offsets of its scrolled ancestors) and re-asserts them after the destination render and
after commit/cancel — but only for nodes that survive the transition, only when the
mutation orphaned focus (never stealing focus the scope moved elsewhere), and only for
non-scroll-driven gestures (a native `AnimationTimeline`/`ScrollTimeline` reads the very
scroll offsets we'd restore, so scroll is left untouched there).

`@solidjs/signals` (re-exported from `solid-js`) — adds the internal
`isReactiveFlushActive()` predicate (true while the global queue is draining render/
user effects), used by `@solidjs/web` to distinguish Solid-driven DOM writes from
asynchronous third-party mutations.
