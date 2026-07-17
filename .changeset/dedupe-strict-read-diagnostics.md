---
"@solidjs/signals": patch
---

Deduplicate the strict-read diagnostics (PENDING_ASYNC_UNTRACKED_READ / STRICT_READ_UNTRACKED) into shared dev helpers used by both core read() and the store proxy traps — the #2897 safeguard parity is now structural (one message source) instead of two hand-kept copies. Dev-only refactor; no behavior change, prod bundles untouched.
