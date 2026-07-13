---
"solid-js": patch
---

Sever reveal-group membership at boundaries during SSR (#2871, #2872)

Only direct `<Loading>` children of a `<Reveal>` now join its group, matching
client semantics where `createCollectionBoundary` clears the reveal controller
context for the subtree of both boundary types:

- A `<Loading>` nested inside another slot's content no longer enrolls in the
  ancestor group, so a slow nested boundary can't stall `order="together"` or
  park a `sequential` frontier. It is covered by its own fallback inside the
  held slot and activates independently — the streamed runtime (from
  `@dom-expressions/runtime` 0.50.0-next.20, whose deferred-activation queue
  this change depends on) queues its swap until the enclosing slot goes live.
- An `<Errored>`-wrapped `<Loading>` likewise no longer holds the group
  hostage; error fallbacks can appear without blocking group progression.

`RevealGroupContext` moved from `server/hydration.ts` to `server/signals.ts`
so `createErrorBoundary` can sever it without a circular import.
