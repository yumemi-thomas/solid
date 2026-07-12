# Bug Hunt Wave 3 — Solid 2.0.0-beta.16 hydration

Date: 2026-07-10  
Branch/commit: `next` at `ef4d53ea`  
Scope: hydration values, lifecycle, event replay, multiple roots, and DOM claiming

This pass found **7 additional reproducible hydration defects**. No runtime fixes or new test
files were left behind; this Markdown file is the only artifact from the pass. Existing scratch
repros and issue drafts are referenced where available.

The earlier inventories remain valid:

- `HUNT-2.0-beta.15.md`: 7 findings still open upstream; 6 already have uncommitted local fixes.
- `HUNT-2.0-beta.15-wave2.md`: 24 of 25 findings still reproduced on beta.16.
- Wave 2 was re-run during this pass: 29 failing signal/store assertions, 11 failing client-DOM
  assertions, and 6 genuine failing SSR assertions. The SSR run also included 2 obsolete
  generator tests that failed only because their old temporary output directory no longer exists.

## New findings

### 1. Hydration corrupts serialized `null` / `undefined` values — P1

There are two manifestations of the same bug:

1. A direct serialized `null` is treated as missing, so the client computation runs and replaces
   the authoritative server value.
2. A settled async envelope such as `{ s: 1, v: null }` or `{ s: 1, v: undefined }` is returned to
   consumers as the envelope object instead of being unwrapped to its value.

Root cause: `packages/solid/src/client/hydration.ts:270-274` uses nullishness both as an existence
test and as the envelope-unwrapping rule:

```ts
function readHydratedValue(initP: any, refresh: () => void) {
  if (initP == null) return NO_HYDRATED_VALUE;
  refresh();
  if (typeof initP === "object" && initP.s === 2) throw initP.v;
  return initP?.v ?? initP;
}
```

`sharedConfig.has(id)` has already established whether the entry exists. A successful envelope
must be unwrapped by status, even when `v` is nullish.

Validation: 3 focused assertions failed:

- direct `null` produced `"client"` and ran the client compute;
- `{ s: 1, v: null }` produced the envelope object;
- `{ s: 1, v: undefined }` produced the envelope object.

Issue-ready draft: `issue-drafts/26-hydration-nullish-serialized-value.md`.

### 2. `ssrSource: "hybrid"` drops synchronous store mutations after hydration — P1

Function-form `createStore` and `createProjection` adopt the serialized server state correctly,
but their first synchronous client recomputation mutates a disposable shadow draft. The function
returns `undefined`, the shadow is discarded, and the visible store remains stuck on the server
value.

Root cause: `packages/solid/src/client/hydration.ts:670-673` activates the real draft only for an
async iterable:

```ts
const { proxy, activate } = createShadowDraft(draft);
const r = fn(proxy);
return isAsyncIterable(r) ? wrapFirstYield(r, activate) : r;
```

Validation: focused `createStore` and `createProjection` repros both retained `"server"` after
hydration instead of applying the synchronous `draft.name = "client"` mutation.

Issue-ready draft: `issue-drafts/27-hydration-hybrid-sync-store-write-dropped.md`.

### 3. Disposing hydration during root-module preload does not cancel the later mount — P1

When the root `_assets` map contains an unloaded module, `hydrate()` delays mounting behind the
dynamic imports. The returned disposer is called before those imports resolve, but it is a no-op
because the real disposer does not exist yet. Once the import resolves, Solid mounts anyway and
attaches live event handlers to a tree the caller already disposed.

Root cause: `@dom-expressions/runtime/src/client.js:530-555` stores the disposer only after the
promise resolves and returns this uncancelled closure:

```js
let disposer;
p.then(() => {
  disposer = render(code, element, [...element.childNodes], options);
});
return () => disposer && disposer();
```

Validation: `packages/solid-web/test/hydration/hunt2-scratch2.spec.tsx:141` disposes before the
module gate opens; clicking afterward still invokes the mounted `A` handler.

### 4. A later `renderId` root is client-rendered instead of hydrated — P1

Hydrating one root completes the global hydration lifecycle and sets `globalThis._$HY.done`.
Calling `hydrate()` later for a second independently rendered root then takes the client-render
path, replacing its server DOM instead of claiming it. This breaks delayed/visible islands and
loses node identity, browser state, and third-party state attached to the server nodes.

Root cause: `@dom-expressions/runtime/src/client.js:489` makes completion global rather than scoped
to a `renderId`:

```js
if (globalThis._$HY.done) return render(code, element, [...element.childNodes], options);
```

This conflicts with the documented `renderId` use for multiple hydration roots in
`packages/solid-web/src/index.ts:177-178`.

Validation: `packages/solid-web/test/hydration/hunt2-scratch4.spec.tsx:27` hydrates roots `ia` and
`ib` sequentially. Root B remains interactive, but its `<button>` is a newly constructed node
rather than the server node.

### 5. One stale queued event blocks every later hydration event — P1

If the pre-hydration event queue begins with an event whose target disappeared before hydration
(for example, a streamed Loading fallback that was replaced), replay stops at that event and
never advances to later events targeting live, successfully hydrated nodes.

Root cause: `@dom-expressions/runtime/src/client.js:684-687` returns without removing an event whose
target is not in `completed`:

```js
const [el, e] = events[0];
if (!completed.has(el)) return;
events.shift();
```

There is no disconnected-target escape, so an event for a node that can never complete becomes a
permanent head-of-line blocker.

Validation: `packages/solid-web/test/hydration/hunt2-scratch.spec.tsx:184` queues a stale removed
fallback click followed by a click on live button B. B's click is never replayed, while later live
clicks work.

### 6. The `hydrate()` disposer deletes SSR DOM despite its public contract — P1

The public API says the disposer tears down reactive scopes while leaving DOM nodes in place, but
disposing a hydrated root empties its container.

The contract is stated at `packages/solid-web/src/index.ts:168-172`. Hydration delegates to the
generic render disposer, which executes `element.textContent = ""` in
`@dom-expressions/runtime/src/client.js:84-88`.

Validation: `packages/solid-web/test/hydration/hunt2-scratch.spec.tsx:216` hydrates server content
`AB`, disposes, and observes an empty container instead of `AB`.

This overlaps implementation-wise with wave 1 finding 20 (render disposal wiping pre-existing
content), but it is a distinct public-contract failure for hydrated SSR content.

### 7. Injected comments permanently break reactive text slots after hydration — P2

Comments injected by browser extensions, CDN/edge rewriters, analytics tools, or A/B systems can
break a hydrated dynamic text slot in two ways:

1. For a sole text child, updates write into `parent.firstChild.data`. If the first child is an
   injected comment, the comment changes while the visible server text remains stale.
2. Between hydration markers, text nodes are claimed positionally. An injected comment shifts the
   expected position, so Solid creates a new text node and leaves the server text orphaned. The
   first update duplicates the visible value (`Count: 01`).

Root causes are the unchecked first-child string fast path and positional normalization in
`@dom-expressions/runtime/src/client.js:898-902` and `:937-951`.

Validation:

```sh
cd packages/solid-web
pnpm vitest run --config vite.config.hydrate.mjs \
  test/hydration/hunt2-injected-comment-text-slot.spec.tsx
```

Result: 2 failed, 1 control passed. Repro:
`packages/solid-web/test/hydration/hunt2-injected-comment-text-slot.spec.tsx`.

## Recommended beta gate order

1. Fix/report the SSR array-attribute injection from wave 2 finding 23 first; it is the only
   confirmed security issue.
2. Fix findings 1-6 above before calling hydration beta-stable. They cause state corruption,
   unexpected client execution, lost event replay, resurrection after disposal, DOM replacement,
   or direct contract violations.
3. Fix the wave 2 P1 regressions next: exotic store objects, keyless reconcile notification,
   draft move identity, writable async memo races, memo cleanup loss, and `<Assets>` SSR crashes.
4. Treat finding 7 as robustness hardening after lifecycle correctness, unless modified HTML from
   edge tooling/browser extensions is a supported beta target.

## Upstream duplicate check

Public GitHub issue searches on 2026-07-10 found no exact issue for:

- `ssrSource: "hybrid"` synchronous store writes;
- sequential `renderId` hydration roots;
- root-module preload disposal;
- stale event queue head-of-line blocking.

The search for hydration + nullish serialization returned closed issue #2857, but that issue is the
separate SSR falsy-rejection bug already covered by wave 1. The findings above appear issue-ready,
subject to a final maintainer-only tracker search because new issue creation is restricted.
