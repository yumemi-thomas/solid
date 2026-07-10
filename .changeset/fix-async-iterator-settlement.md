---
"@solidjs/signals": patch
---

Fix async iterator settlement when the iterator completes before yielding or returns a thenable that rejects synchronously. Empty iterators now settle to `undefined`; synchronous iterator rejections reach error boundaries with their original value, including after an asynchronous yield, without producing an unhandled rejection.
