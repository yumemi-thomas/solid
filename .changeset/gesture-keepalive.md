---
"@solidjs/web": patch
---

Add `UnstableKeepAlive` — identity-preserving control flow for gesture View
Transitions.

A gesture computes its destination by mutating the single live reactive tree, so a
structurally-replaced branch (a keyed `<Show>`/`<Switch>` swap) is disposed and
recreated as fresh nodes — losing live state on cancel. `UnstableKeepAlive` is a
drop-in for a keyed `<Show>` that, **during a gesture**, detaches and *retains* the
outgoing branch (its reactive owner stays live, its nodes move off-document) instead of
disposing it, so `cancelGesture()` reattaches the *same* nodes. Node identity — and
therefore all live state, including the non-serializable tail (`<video>`/`MediaStream`,
WebGL, third-party widgets, JS state on the node) that `data-vt-preserve` cannot
recover — survives a cancelled scrub. Scroll positions of inner containers are
explicitly snapshotted across the detach/reattach (which would otherwise reset them).
Outside a gesture it behaves exactly like keyed
`<Show>` (disposes immediately, no retention or leak); retained branches are disposed
once the gesture settles (commit keeps the destination, cancel keeps the origin). It
auto-detects the gesture lifecycle via an internal ref-counted active flag + settle
notification in `startGestureTransition`. Opt-in and `unstable_` while the gesture API
is experimental; documented in `packages/solid-web/VIEW_TRANSITIONS.md` and
`RFC-gesture-keepalive.md`, covered by Chromium browser tests.

The name is capitalized so it works directly as a JSX component (`<UnstableKeepAlive>`),
while the `Unstable` prefix keeps its experimental status explicit. It is exported from
both the client and server builds; on the server it renders the current branch like a
keyed `<Show>` (no gesture machinery), covered by an SSR test.
