---
"@solidjs/signals": patch
---

Restore safeguard parity for derived stores read in component bodies (#2897): an untracked read of a store whose firewall is in flight now throws the dev-mode PENDING_ASYNC_UNTRACKED_READ error, matching pending memos. Previously the store proxy's untracked path skipped node creation — and with it the safeguard — silently returning the seed value with only the strict-read warning.
