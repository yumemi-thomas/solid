---
"@solidjs/web": patch
---

Fix `Portal` stranding one empty text node in its mount target per unmount: the cleanup removed the nodes in `[startMarker, endMarker)` but never `endMarker` itself, which the same effect run had appended. Toggling a Portal (the modal open/close pattern) accumulated one node per cycle, unbounded — invisible to `innerHTML` checks but breaking `:empty` selectors and `childNodes` counts on the mount target. The removal range is now inclusive of `endMarker`.
