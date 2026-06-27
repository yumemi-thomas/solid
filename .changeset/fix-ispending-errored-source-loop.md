---
"@solidjs/signals": patch
---

Fix `isPending` on an async source that errors (#2790). `isPending` reading an
errored source now resolves to `false` (both synchronously and asynchronously)
instead of livelocking or surfacing an unhandled rejection. Three layered changes:

- Async propagation: the link an `isPending` read creates is tagged as a
  pending-observer. When the source errors, `notifyStatus` re-runs the observer
  (so `isPending` re-evaluates to not-pending) instead of forwarding the error
  through it — preventing the error from escaping (e.g. out of an `<Errored>`
  fallback, which its own boundary cannot catch) as an unhandled rejection.
- `isPending` observation: the errored-retry in `read` is gated behind
  `!pendingCheckActive`, so a pending check observes the errored status (the
  stored error is thrown and swallowed by `isPending`) rather than re-running the
  async body — which would re-fetch, flip the source back to pending, and livelock
  on a source that keeps failing.
- Retry policy: the errored-retry in `read` is additionally gated behind
  `tracking`. An errored async source only retries when re-read from an
  owned/tracked scope (a reactive recomputation) in a later cycle. Naked/ownerless
  reads — events, `untrack`, an effect's side-effect phase — surface the stored
  error without re-fetching.
