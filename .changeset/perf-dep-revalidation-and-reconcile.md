---
"@solidjs/signals": patch
---

perf: O(1) dependency revalidation and reconcile allocation trims (from #2756)

- Replace the `isValidLink` dep-list scan with a per-recompute generation stamp
  on links, eliminating O(n²) behavior when a computation re-reads a dependency
  it already saw during the same pass (deep-tree reconcile with all paths
  subscribed: ~7x faster)
- Reconcile: reuse the existing key array when key sets match in `getAllKeys`,
  and skip symbol lookups on primitive leaves in `unwrap`
- Avoid the `untrack` closure in `getKeys` for plain (non-proxy) sources
- Cache one bound effect runner per effect instead of allocating per update
