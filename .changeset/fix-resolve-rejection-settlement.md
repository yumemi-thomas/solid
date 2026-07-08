---
"@solidjs/signals": patch
---

Fix `resolve()` never settling (and leaking its root) when the async source rejects (#2842)

`resolve()` was built on a bare, subscriber-less computed: a pending source
that *resolved* re-enqueued it, but a *rejection* only marked it errored for
a pull that never came — the promise hung forever and the internal root was
never disposed. Rebuilt on a user effect, whose error-notification channel is
actively told about rejections: the promise now rejects with the user's
original error (unwrapped from the internal `StatusError`, matching error
boundaries) and the root is disposed on every terminal state.
