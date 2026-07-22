---
"@solidjs/web": patch
---

Frames: hydration claims are now gated to the adoption attach
(`ctx.adopted`) — a stream-driven re-call of an adopted occurrence renders
for real instead of claiming, so content the re-call displaces (moved-out
`{$frame}` region ranges) is re-placed rather than silently dropped
(dom-expressions#547).
