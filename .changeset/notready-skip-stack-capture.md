---
"@solidjs/signals": patch
---

`NotReadyError` no longer pays V8's eager stack capture in production builds. It is thrown on every read of a pending source — pure control flow, with real cost proportional to stack depth under SSR — so the constructor now zeroes `Error.stackTraceLimit` around `super()` on V8 and restores it after. Dev builds keep full stacks for debuggability; non-V8 engines take the plain path.
