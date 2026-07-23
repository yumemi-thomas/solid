---
"@solidjs/signals": patch
---

`reconcile`'s `key` parameter is now optional, defaulting to `"id"`, and accepts `null` to opt into purely positional merging — index N of the new array merges into index N of the old, preserving slot identity with no keyed diff pass. This restores the classic 1.x `{ key: null, merge: true }` pattern (fixed-shape data that churns in place — dashboards, monitors); merge semantics are always on in 2.0. Items missing the key field already fell back to positional matching, so the `"id"` default degrades gracefully for unkeyed data.
