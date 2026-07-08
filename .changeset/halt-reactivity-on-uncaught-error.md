---
"@solidjs/signals": patch
---

An error that escapes every error boundary now permanently halts the reactive system instead of leaving it in a partially-updated state (#2761, #2762). The error still throws through as an uncaught exception; after that, further writes and flushes are ignored and a `REACTIVITY_HALTED` message is logged. Handle errors with `createErrorBoundary`/`<Errored>`, or treat an uncaught error as an app crash. `resetErrorHalt()` is exposed for tests and dev tooling.
