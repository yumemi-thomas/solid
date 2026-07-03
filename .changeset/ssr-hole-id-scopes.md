---
"solid-js": patch
"@solidjs/web": patch
---

Fix hydration key mismatches when async holes defer past eager siblings
(#2801 bug 2). New `ssrScope` (server): reserves one hydration id slot at
registration and evaluates the hole — including async retries — under the
reserved id with a zeroed child counter (a virtual scope in the style of
mapArray's row-owner elision, so no owner allocation on the hot path). On
the client, `@solidjs/web`'s `effect` wrapper now honors a `scope: true`
option (set by the dom-expressions `insert` for compiler-tagged hole
accessors) that makes the outer insert render effect non-transparent, giving
the same hole its own id scope. Hole content ids gain one nesting level
identically on both sides, so deferral timing can no longer shift sibling
hydration keys.
