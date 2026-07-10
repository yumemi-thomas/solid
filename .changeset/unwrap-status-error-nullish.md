---
"@solidjs/signals": patch
---

Nullish async rejections (`Promise.reject()`, `reject(null)`) now reach user error surfaces as the rejected value instead of the internal `StatusError` wrapper. Both unwrap sites — the `Errored`/`createErrorBoundary` fallback and the effect bundle's `error` arm (including its no-handler `console.error` fallback) — recovered the user error via `cause ?? wrapper`, and `StatusError` always installs `cause` (even for `undefined`/`null`), so nullish rejections fell back to the wrapper itself: an undocumented type carrying a reactive `.source` node, which also broke `err() == null` branching in fallbacks. The unwrap is centralized in `unwrapStatusError()`, which tests the wrapper type instead. Non-nullish errors are unaffected.
