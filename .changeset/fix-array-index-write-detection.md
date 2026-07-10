---
"@solidjs/signals": patch
---

Stricter array index detection for store writes. Any string property on an array (except `length`) was fed through `parseInt` to derive a length extension, so non-index keys like `"01"`, `"1.5"`, or `"1e2"` were treated as index writes and could grow the array's length. Writes now only count as index writes for canonical array indices (`String(Number(p)) === p`, integer, in bounds), matching the ECMAScript definition.
