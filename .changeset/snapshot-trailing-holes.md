---
"@solidjs/signals": patch
---

Fix `snapshot()` and `deep()` shrinking an array's length when trailing indices were deleted (#2846)

`delete arr[i]` on a store leaves a hole without changing `length` — plain
JS semantics, and every proxy-side read agrees — but `snapshotImpl`'s array
branch skipped `$DELETED` slots without restoring the result's length, so
trailing holes truncated the copy (at any nesting depth, for either API).
The array branch now restores the length after the loop, mirroring
`unwrapStoreValue`, so deleted slots stay holes (`i in copy === false`,
serialized as `null`).
