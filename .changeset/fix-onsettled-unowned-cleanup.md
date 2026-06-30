---
"@solidjs/signals": patch
---

`onSettled` no longer runs a returned cleanup eagerly when it fires from an unowned scope (an event handler, a tracked effect, or another `onSettled`). A cleanup is only meaningful when `onSettled` runs in an owned scope, where it fires on owner disposal. In an out-of-band fire there is no owner lifecycle to bind to, so previously the cleanup was invoked immediately in the same flush — tearing down setup-with-teardown helpers the instant they installed. Returning a cleanup from such a scope is now a dev-mode error (`SETTLED_CLEANUP_UNOWNED`) guiding the call into an owned scope, and is dropped in production. The out-of-band one-shot fire itself (no cleanup) is unchanged.
