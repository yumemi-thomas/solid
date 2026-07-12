# PR draft — ryansolid/dom-expressions

**Branch:** `fix/df-deferred-swap-queue` (commit `fab13eba`, based on `next` @ `2c05b021`)
**Title:** `fix(runtime): queue $df/$dfl activations until their pl-* markers are live`

---

## Body

Fixes the runtime half of solidjs/solid#<ISSUE-01> (safe to land standalone — pure robustness; the solid half depends on this).

### Problem

`$df(key)` locates its marker with `document.getElementById("pl-" + key)` and returns 0 when it isn't found — with no queue or retry, the swap is lost forever. A marker inside another fragment's not-yet-swapped `<template>` is part of that template's inert content fragment, invisible to `getElementById`. The window where this happens is **flushed-but-unactivated**: a reveal-group slot whose template is already on the wire while `$dfj` is still held. A fragment nested in such a slot that settles before the group releases emits `$df("N")` into that window; after the group activates, the nested fallback is stuck forever and `<template id="N">` sits inert.

The buffered-replace path already protects the *unflushed* window (a child settling before its parent flushes is inlined into the parent's buffer via `waitForFragments`), so this is the only unprotected ordering. Today it is masked in solid only because of a separate membership bug (nested boundaries incorrectly join the ancestor reveal group, so their `$df` always runs inside the group's `$dfj` after their ancestors) — fixing that in solid exposes this gap.

`$dflj`/`$dfl` (collapsed-fallback materialization) has the same miss shape and is equally reachable: a collapsed nested group's `revealFallbacks` can fire while its ancestor slot is held.

### Fix

- `$df`: a miss with the content template **present** queues the key on `_$HY.dq`; a missing template means the swap already ran — repeated calls stay unqueued no-ops.
- `$dfl`: a missing marker queues on `_$HY.dlq`.
- Shared `$dfd()` drains both queues after every successful swap or fallback materialization — the only events that bring new markers into the live document. `$df` drains before `$dfl`, so a content swap wins over a pending fallback for the same id. Drains process a snapshot, so still-held re-queues terminate.

### Tests

`packages/runtime/test/ssr/stream-deferred-swap.spec.js` — streams built with `renderToStream` + manual `ctx.registerFragment`, replayed into jsdom the way a streaming browser would (markup applied, inline scripts evaluated in arrival order):

1. nested fragment settling **before** the group releases — red on stock (`outer-contentnested-fallback`), green with fix
2. settling **after** the release — control, green on both
3. repeated `$df`/`$dfj` for already-swapped keys — no-op, DOM byte-identical, nothing queued
4. `$dfl` for a collapsed fallback inside a held slot — red on stock, green with fix

Full runtime suite: 546/546. Changeset included (patch, per the prerelease policy).

### Points worth a maintainer's eye

- A `$dfl` whose marker was consumed by an earlier `$df` stays a dead queue entry retried as a no-op on later drains (bounded by key count). Distinguishing "consumed" from "held" isn't possible from the fallback side — the pl-template is the only anchor and `$df` removes it.
- The alternative — sequencing activations server-side (a "passenger" protocol on reveal groups) — was evaluated and rejected: it needs per-ancestor activation chaining for deep nesting and per-order bookkeeping for sequential/collapsed, all of which the client-side drain gets for free.

Cross-repo validation lives in the solid repo (`packages/solid-web/test/hydration/hunt3-reveal-replay.spec.tsx`): real solid `<Reveal>`/`<Loading>` streams replayed against stock vs patched runtime.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
