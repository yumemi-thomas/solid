---
"solid-js": patch
---

Fixed a pending `<Loading>` leaking its asset-attribution scope to later document-order siblings during streaming SSR (#2860). The boundary assigned `_currentBoundaryId` on its buffered context at creation, but the property is an accessor inherited from the root context over shared tracking state — the assignment mutated the global boundary id with no restore, so a root-level `lazy()` after the boundary filed its module under the boundary's already-serialized asset map instead of the root `_assets` map, and that island never hydrated. The creation-time assignment is removed; every render phase already scopes the id correctly via `runWithBoundaryErrorContext`, which sets and restores it around the run.
