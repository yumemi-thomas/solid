---
"@solidjs/signals": patch
---

Restore safeguard parity for derived stores read outside tracking (#2897), matching async memos. The seed of a derived store is a draft for the derive function, never an observable value: until the first resolution (or first async-iterator yield) lands, any outside read, `in` check, or enumeration of the store now throws NotReadyError — in dev strictRead scopes (component bodies) the more descriptive PENDING_ASYNC_UNTRACKED_READ error wins. Self reads from the derive function are exempt (that is what the seed is for), as are reconcile's write-path reads. Previously the store proxy's untracked path skipped node creation — and with it every safeguard — silently returning the seed value.
