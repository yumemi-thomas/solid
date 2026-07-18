---
"@solidjs/signals": patch
---

Document the `action()` transaction contract across `await` (#2913, ruled behaves-as-designed): `yield` is the only transaction-safe suspension point — writes to fresh signals between an internal `await` and the next `yield` escape the transaction. Use `await` for typed results, then a bare `yield` before writing to re-enter the transaction. Calling `flush()` inside an action body is out of contract.
