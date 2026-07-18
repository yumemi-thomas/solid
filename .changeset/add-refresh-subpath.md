---
"solid-js": patch
---

Add a dev-only `solid-js/refresh` subpath entry hosting the HMR component-swap runtime (ported from the standalone `solid-refresh` package). Compiled HMR wrappers keep the frozen `$$registry`/`$$component`/`$$refresh`/`$$decline` ABI and the `hot.data` protocol; the production build resolves to inert stubs. The "cannot hot-swap" bail path is now configurable via `configureRefresh({ invalidate })` instead of hardcoding `window.location.reload()`.
