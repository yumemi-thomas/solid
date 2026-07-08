---
"@solidjs/signals": patch
---

Calling an action synchronously inside an owned scope (component body, computation) is now a dev-mode error (`ACTION_CALLED_IN_OWNED_SCOPE`), matching the existing write guards. Previously the call went through silently — post-await writes run with no ambient owner, so the write guard never fired, and a computation tracking what its action writes would livelock (each write retriggered the compute, firing a fresh invocation whose transition superseded the last; the value never committed). Actions remain callable from event handlers, effect callbacks, tracked effects/`onSettled`, and other imperative scopes.
