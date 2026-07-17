---
"@solidjs/signals": patch
---

Preserve enumerable symbol-keyed properties when snapshotting and deeply
tracking stores, including array metadata and untouched nested values. Make
setter drafts writable when the store type is readonly.
