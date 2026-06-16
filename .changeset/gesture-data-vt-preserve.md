---
"@solidjs/web": patch
---

Recover serializable live state across a cancelled gesture View Transition with
`data-vt-preserve`.

A gesture computes its destination by mutating the single live reactive tree, so a
structurally-replaced branch is disposed and recreated as fresh nodes — losing live
interactive state on cancel. `captureInteractionState` already restores focus/caret/
scroll for *surviving* nodes; it now also snapshots the serializable state of any
element marked `data-vt-preserve="<key>"` (media `currentTime`/`paused`/`playbackRate`,
`<details>`/`<dialog>` `open`, form `value`/`checked`, and scroll) and re-asserts it on
the commit/cancel reveal. On cancel it matches the captured state to a structurally-
recreated element by its app-provided key, so e.g. an uncontrolled input keeps the
user's text and a `<video>` keeps its position across a cancelled scrub. Applied only
on the final reveal (never mid-scrub) and identity/key-guarded so it never targets
destination content. Non-serializable state (live `MediaStream`, WebGL, iframe
internals) still requires node-identity preservation and is out of scope. Documented in
`packages/solid-web/VIEW_TRANSITIONS.md`; covered by Chromium browser tests.
