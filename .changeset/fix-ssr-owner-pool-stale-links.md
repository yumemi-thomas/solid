---
"solid-js": patch
---

Unlink disposed SSR owners from their parent's child chain before pooling. The pool cleared `_parent`/`_nextSibling` on the recycled node, but the parent's `_firstChild`/sibling chain still referenced it — so once the pool reused the owner in a different tree, disposing the old parent walked its stale chain and disposed live owners in the new tree. Boundary retries (`self=false`) are unaffected; subtree disposal still unlinks each child in O(1).
