# Bug Hunt Wave 2 — Solid 2.0.0-beta.15 (unreported findings)

Date: 2026-07-05/06. Hunted at `next` HEAD `bad66625` (beta.15 + post-release fixes), after the 20 findings in `HUNT-2.0-beta.15.md`. This wave fanned six independent deep-dives — async/boundaries, stores-deep, core reactivity, client DOM, SSR, hydration — over areas the first pass didn't reach. **25 confirmed findings** (42 failing assertions, all with passing controls). Each has a runnable repro left in place as an untracked test file asserting the *correct* behavior, so it fails while the bug exists. The hydration deep-dive did not complete (agent hit a session limit before producing findings) — that surface remains open for a follow-up.

> **Re-verified 2026-07-09 against `next` `ef4d53ea` (2.0.0-beta.16 + 4 commits)** in a clean
> worktree: **24 of 25 still reproduce.** Resolved: **#7 `resolve()` rejection hang → #2842**
> (repro `hunt2-resolve-rejection.test.ts` + draft `w7` removed). Note: #2841 (settle
> async-generator actions on uncaught errors) landed too, but does **not** cover #10
> (empty async iterable) or #11 (iterator-branch sync rejection) — both still reproduce.

> **Re-verified 2026-07-11 against `next` `a51cac19` (2.0.0-beta.17)**: **20 of 25 still
> reproduce.** Newly resolved (repros, 1.x checks, and drafts removed):
> - **#9 Errored StatusError wrapper → issue #2866, fixed by PR #2867** (`c3b83146`)
> - **#10 empty async iterable pends → issue #2868, fixed by PR #2870** (`286fa3f8`)
> - **#11 iterator sync rejection dropped → issue #2869, fixed by PR #2870** (`286fa3f8`)
> - **#23 array-attribute XSS → dom-expressions PR #541**, shipped via the
>   0.50.0-next.17 bump (`b15dfab7`) — repro passes with the escaped output.

Every finding was cross-checked against `HUNT-2.0-beta.15.md`, the `issue-drafts/`, and the open/closed upstream issue + PR list; none duplicate a known item.

## How to run

- signals/store/core: `cd packages/solid-signals && pnpm vitest run tests/hunt2-*.test.ts tests/store/hunt2-*.test.ts`
- web client: `cd packages/solid-web && pnpm vitest run test/hunt2-*.spec.tsx`
- SSR: `cd packages/solid-web && pnpm vitest run --config vite.config.server.mjs test/server/hunt2-*.spec.tsx`
- 1.x comparison: see `hunt-1x-checks/` (checks named `w2-*`).

## Solid 1.x triage (what breaks existing apps vs. new-API surface)

The single most useful cut for "ship 2.0 without regressions". Verified against solid-js **1.9.14** in `hunt-1x-checks/`.

**Regressions from 1.x (1.x is correct — these break existing apps on upgrade):**
1 Map/Set/Date store values, 2 reconcile keyless leaf, 3 snapshot symbol keys, 4 accessor-setter write, 6 draft-reassign identity, 22 `useAssets`/`<Assets>` element children crash. (9 errored falsy-rejection wrapper leak — **resolved in beta.17, #2866**.)

**2.0-only API surface (new in 2.0 — no 1.x counterpart, but must work for GA):**
8 writable async-memo setter race, 12 memo double-recompute lost cleanup, 13 error-heal-to-equal stuck, 14 boundary-dispose skips sibling queue. (7 `resolve()` rejection hang — **resolved in beta.16, #2842**; 10 empty async-iterable pend / 11 async-iterator sync-rejection drop — **resolved in beta.17, #2868/#2869**.)

**Long-standing (also broken in 1.x — not regressions, lower priority for a 2.0 gate but still real):**
5 `Object.freeze(store)` poisoning, 15 throwing-effect drops sibling effects, 16 mapArray falsy-fallback recreate/leak, 18 non-delegated tuple mutation, 19 property-binding `undefined` renders "undefined", 20 fragment stranded children, 21 dev crash on frozen component, 24 style leading-`;`, 25 classList leading-space. (23 array-attribute XSS — **resolved in beta.17, dom-expressions #541**.)

**Inconclusive:** 17 delegated bound-handler stale data — 1.x binds direct JSX handlers once (non-reactive), so the reactive-swap path that triggers the 2.0 bug has no 1.x equivalent.

---

## Stores (deep)

### 1. Map/Set/Date store values crash on internal-slot access and on any draft method — P1, **regression**
`state.cache.size` / `state.tags.size` throw `TypeError: Method get Map.prototype.size called on incompatible receiver`; `Map.set`/`Set.add`/`Date.setFullYear` inside a setter draft throw `called on incompatible receiver`.
- Root cause: `packages/solid-signals/src/store/store.ts` get trap. Read path (451-455) invokes inherited accessors via `Reflect.get(storeValue, property, receiver)` with the **proxy** as receiver — proxies don't forward internal slots. Write path (458-474) returns prototype methods **unbound** (the read path at 481-492 does `value.bind(storeValue)`).
- 2.0's `isWrappable` (store.ts:149) wraps any non-frozen non-`Node` object (1.x excluded non-plain objects), so `createStore({ cache: new Map(), createdAt: new Date() })` is natural and crashes on first `.size` read.
- Repro: `packages/solid-signals/tests/store/hunt2-map-set-date-builtins.test.ts` (5 fail + 2 control). 1.x: `hunt-1x-checks/checks/w2-store-map-set-date.test.ts` (passes).

### 2. `reconcile()` updates but never notifies for keyless wrappable leaves (Date/Map/Set/RegExp) — P1, **regression**
`setState(reconcile({ updatedAt: newDate }))` swaps the value (untracked read returns the new date) but fires zero notifications — a heisenbug where a later unrelated render suddenly shows the changed value.
- Root cause: `packages/solid-signals/src/store/reconcile.ts` values branch (`applyStateFast` 184-205 / `applyStateSlow` 334-355). Both values are wrappable + same array-ness with a null key → reconcile recurses and diffs **own enumerable keys**; internal-slot objects have none, so no `setSignal`/`notifySelf`. 1.x treats these as leaves (`prev !== next` → replace + notify).
- Repro: `tests/store/hunt2-reconcile-keyless-leaf.test.ts` (2 fail + control). 1.x: `w2-store-reconcile-keyless-leaf.test.ts` (passes).

### 3. `snapshot()`/store-to-store writes drop symbol keys once the object has been written — P2, **regression**
`snap[sym]` / `b.copied[sym]` become `undefined` after any prior write to the subtree.
- Root cause: `getKeys()` (`store.ts:284-298`) seeds from `Object.keys(source)` (strings only), driving both `snapshotImpl` (`utils.ts:60`) and `unwrapStoreValue` (`store.ts:178`). Residual gap of #2769, which added `ownEnumerableKeys` only to setter/merge/omit/set-trap sites, not the snapshot/unwrap enumeration.
- Repro: `tests/store/hunt2-snapshot-symbol-keys.test.ts` (2 fail + control). 1.x: `w2-store-unwrap-symbol-keys.test.ts` (passes).

### 4. Writing through an own accessor never invokes the setter and kills the getter — P2, **regression**
`setState("full", v)` on a `get/set full` pair lands as a plain override; the setter is bypassed and the getter is thereafter shadowed by the data override (both dead). Get side honors accessors (store.ts:449-450) — internal inconsistency. 1.x invokes the setter (getter still shadowed after — 2.0 is worse: it bypasses validation/normalization entirely).
- Root cause: set trap (`store.ts:551-634`) never consults the source property descriptor.
- Repro: `tests/store/hunt2-accessor-setter-shadowed.test.ts` (2 fail + control). 1.x: `w2-store-accessor-setter.test.ts` (setter invoked; getter-shadow shared).

### 5. `Object.freeze(store)` permanently poisons the store — P2, long-standing (worse in 2.0)
After `Object.freeze(state)`: `Object.keys` throws `'ownKeys' on proxy: trap result did not include 'v'` (leaks internal target shape); writes and effect tracking throw `Cannot add property …, object is not extensible`.
- Root cause: `storeTraps` (`store.ts:409-752`) has no `preventExtensions`/`isExtensible` traps, so freeze forwards `[[PreventExtensions]]` to the internal `{v: source}` target; the ownKeys invariant then enforces against the target's real keys, and every internal mutation (`getNodes` 224-228, override creation 590) throws. 1.x also breaks under freeze (throws when creating store nodes) but with a narrower blast radius.
- Repro: `tests/store/hunt2-freeze-store-proxy.test.ts` (2 fail). 1.x: `w2-store-freeze.test.ts` (also throws).

### 6. Draft re-assignment (row swap/move) clones previously-edited subtrees — store identity lost — P1, **regression**
`const t = s.list[i]; s.list[i] = s.list[j]; s.list[j] = t` — any row previously written gets cloned rather than moved: keyed `<For>` tears down & rebuilds its DOM (focus/state lost) and captured row proxies detach from the store.
- Root cause: every draft assignment routes through `unwrapStoreValue` (set trap, store.ts:570); for a subtree with a `STORE_OVERRIDE`, `unwrapStoreValue` (store.ts:164-185) materializes a fresh clone instead of a stable underlying value.
- Repro: `tests/store/hunt2-draft-reassign-identity.test.ts` (2 fail). 1.x: `w2-store-draft-reassign-identity.test.ts` (passes).

## Async primitives & boundaries (client)

### 8. Writable async memo: setter writes silently swallowed while a fetch is in flight — P1 (new-API)
`setDraft(edited)` during an in-flight fetch never becomes visible (accessor, render effects, `latest()` all miss it) and the fetch result clobbers it. Contradicts the `setMemo` JSDoc ("the manual value wins").
- Root cause: `packages/solid-signals/src/core/`. (a) `setSignal` (core.ts:976-977) writes `_pendingValue` on a `STATUS_PENDING` computed without clearing pending/`_inFlight`; (b) `asyncWrite`'s stale-result guard (async.ts:208) checks only `REACTIVE_DIRTY | REACTIVE_OPTIMISTIC_DIRTY`, but a manual write sets `REACTIVE_MANUAL_WRITE` (core.ts:1001-1019), so the superseded promise's `setSignal` overwrites it.
- Repro: `tests/hunt2-writable-async-memo-race.test.ts` (2 fail + control).

### ~~9. `Errored` fallback receives the internal `StatusError` wrapper for bare rejections~~ — resolved in beta.17 (#2866 → PR #2867)

### ~~10. Async iterable that completes without yielding pends forever~~ — resolved in beta.17 (#2868 → PR #2870)

### ~~11. Async-iterator rejection delivered synchronously is silently dropped~~ — resolved in beta.17 (#2869 → PR #2870)

## Core reactivity

### 12. Memo recomputed twice in one flush loses the first run's cleanups and children — P1 (2.0 machinery)
A memo that recomputes a second time before `commitPendingNodes` (trivially: a higher computation writes an `ownedWrite` dep) never fires the superseded run's `onCleanup` and never disposes its child owners — zombie subscriptions/listeners leak one per double-recompute.
- Root cause: `packages/solid-signals/src/core/core.ts:162-170` — non-create `recompute` blindly overwrites `_pendingDisposal`/`_pendingFirstChild`, clobbering the earlier stash.
- Repro: `tests/hunt2-memo-double-recompute-lost-cleanup.test.ts` (1 fail + control).

### 13. Memo that errored, then heals to an `equals`-equal value, never clears the error downstream — P1 (new-API)
Recovery to the same value notifies nobody; downstream effects stay on the error fallback and untracked reads throw the stale error forever. Docs promise auto-heal (MIGRATION.md:971).
- Root cause: `core.ts:277-315` — post-recompute `insertSubs` runs only on `valueChanged` (vs the pre-error `_value`); and there is no error analog of `settlePendingSource` to clear downstream `STATUS_ERROR`/`_error` (async.ts:112, 356-436).
- Repro: `tests/hunt2-error-heal-equal-value.test.ts` (2 fail + control).

### 14. Effect that disposes its own boundary skips a sibling boundary's queued effects — P2 (2.0 scheduler)
Disposing boundary A from inside A's own effect splices A out of `_children` and shifts sibling B into the already-visited slot; B's queued effects (including DOM render effects) don't run and no new flush is scheduled — they wait for an unrelated write.
- Root cause: `packages/solid-signals/src/core/scheduler.ts:259-266` (`Queue.run` iterates by live index) + `removeChild` (248-254) splicing mid-iteration.
- Repro: `tests/hunt2-boundary-dispose-skips-sibling-queue.test.ts` (1 fail).

### 15. Unhandled throw in one effect permanently drops sibling effects queued in the same flush — P2, long-standing
One throwing effect aborts the flush loop; the detached remaining-callbacks array is discarded and those nodes already recomputed, so they're never re-enqueued. (#2761/#2762 fixed scheduler *state* recovery — later flushes work — but not the same-flush sibling loss.) Also broken in 1.x.
- Root cause: `scheduler.ts:687-689` (`runQueue`, no per-callback isolation) + `Queue.run` detaching the array (260-262) + rethrow at `effect.ts:145`.
- Repro: `tests/hunt2-throwing-effect-drops-sibling-effects.test.ts` (1 fail). 1.x: `w2-core-throwing-effect-siblings.test.ts` (also drops).

### 16. `mapArray`/`repeat` falsy fallback recreated every empty update, leaking owners — P2/P3, long-standing
A fallback returning `null`/`0`/`""`/`false` re-runs on every update that keeps the collection empty, overwriting `_nodes[0]` with a fresh (undisposed) owner. Also broken in 1.x.
- Root cause: `packages/solid-signals/src/map.ts:152` & `:334` — fallback existence tested by truthiness of the cached mapped value.
- Repro: `tests/hunt2-map-falsy-fallback.test.ts` (3 fail + control). 1.x: `w2-core-map-falsy-fallback.test.ts` (also leaks).

## Client DOM

### 17. Delegated bound handler `[fn, data]` leaks its data to a later handler on the same element — P1, inconclusive vs 1.x
After swapping `onClick={[fn, {id:1}]}` for a plain `fn2`, `fn2` is invoked as `fn2({id:1}, event)`; even removal-then-re-add resurrects the ancient data.
- Root cause: `addEvent` (dom-expressions runtime `client.js:236-241`) sets `$$clickData` for the array form but never clears it when a later update installs a non-array handler; `eventHandler` (client.js:718-721) dispatches on `data !== undefined`.
- 1.x binds direct JSX handlers once (non-reactive), so the reactive-swap path has no 1.x equivalent.
- Repro: `packages/solid-web/test/hunt2-delegated-bound-data-stale.spec.tsx` (2 fail).

### 18. Non-delegated `[fn, data]` mutates the user's tuple; a shared tuple passes data as the event — P1, long-standing
Second element sharing a tuple receives `(data, data)` (2.0) — the data replaces the event; `tuple[0] !== fn` after render (user array mutated). 1.x is also broken (second element gets `(data, null)` and also mutates the tuple).
- Root cause: `addEvent` (client.js:243) does `handler[0] = e => handlerFn.call(node, handler[1], e)` — the wrapper is written back into the user's array, so a second element wraps the first wrapper.
- Repro: `test/hunt2-bound-handler-array-mutation.spec.tsx` (2 fail + control). 1.x: `w2-dom-bound-array-mutation.test.tsx` (also broken).

### 19. `undefined` in property-path bindings renders the literal string "undefined" — P2, long-standing
`innerHTML={h()}` / `textContent={t()}` cleared to undefined, and spread `{value: undefined}`, render the text `undefined`. The compiler's own direct `value` binding emits `_v$ ?? ""` — proving undefined-clear is the intended semantic that the other property paths missed. Also broken in 1.x.
- Root cause: compiler emits bare `el.innerHTML = e` / `textNode.data = t`; runtime spread `assignProp` does `node[prop] = value` unguarded (client runtime spread path).
- Repro: `test/hunt2-property-binding-undefined.spec.tsx` (3 fail + 2 controls). 1.x: `w2-dom-property-undefined.test.tsx` (also renders "undefined").

### 20. DocumentFragment children stranded in the DOM after a slot update — P2, long-standing
Replacing a `DocumentFragment` child with text/another fragment leaves the old children behind (`before12xafter`); fragment→fragment accumulates. `JSX.Element` includes `Node`. Also broken in 1.x.
- Root cause: 2.0's `flatten`/`normalize`/`insertExpression` have no `nodeType === 11` handling (1.x's `normalizeIncomingArray` expanded fragments); the emptied fragment is kept as `current` with `parentNode === null`, failing all ownership checks.
- Repro: `test/hunt2-fragment-stale-children.spec.tsx` (2 fail + control). 1.x: `w2-dom-fragment-stale.test.tsx` (also strands).

### 21. Dev build crashes on any frozen/non-extensible component — P2 (dev-only), long-standing
`<Dynamic component={Object.freeze(Comp)}/>` and direct JSX `<Frozen/>` throw `Cannot add property Symbol(COMPONENT_DEV), object is not extensible`; prod works. Also broken in 1.x (`Symbol(solid-dev-component)`).
- Root cause: dev unconditionally `Object.assign(Comp, { [$DEVCOMP]: true })` at `packages/solid/src/client/core.ts:198`, `client/component.ts:138`, `packages/solid-web/src/index.ts:291` (no extensibility guard; also mutates the user's function).
- Repro: `test/hunt2-dynamic-frozen-component.spec.tsx` (2 fail). 1.x: `w2-dom-frozen-component.test.tsx` (also throws).

## SSR

### 22. `<Assets>` / `useAssets()` with element children crashes SSR — P1, **regression**
The canonical head-injection pattern (`useAssets(() => <link/>)`, exactly what `@solidjs/meta` uses) throws `getNextContextId cannot be used under non-hydrating context`; `renderToStream` hangs then throws. String children are HTML-escaped, so raw `<head>` markup can't be injected either.
- Root cause: asset thunks are invoked in `getAssets()`/`injectAssets()` (dom-expressions `server.js`) *after* `root()` returns, when `currentOwner` is `null`; rendering the element calls `ssrHydrationKey()` → `getNextContextId()` whose first line is `const o = getOwner(); if (!o) throw` (`packages/solid/src/server/shared.ts:56-57`).
- Repro: `packages/solid-web/test/server/hunt2-assets-element-crash.spec.tsx` (3 fail + stream variant hangs). 1.x: `hunt-1x-checks/server-checks/w2-assets-element.test.tsx` (renders into `<head>` fine).

### ~~23. Array-valued attribute emitted UNESCAPED → XSS~~ — resolved in beta.17 (dom-expressions #541, shipped in 0.50.0-next.17)

### 24 & 25. Object `style`/`class` SSR string assembly emits a leading separator when the first entry is skipped — P3, long-standing
`style={{ color: undefined, background: "red" }}` → `style=";background:red"`; `class={{ a:false, b:true, c:true }}` → `class=" b c"` (2.0 also double-spaces). Browsers tolerate it, but static `renderToString` output and the pre-hydration paint diverge from the client. Also present in 1.x.
- Root cause: separator keyed on loop index not on prior output — `ssrStyle` `if (i) result += ";"` (server.js:835), `ssrClassName` `i && (result += " ")` (server.js:815).
- Repro: `test/server/hunt2-object-binding-leading-separator.spec.tsx` (2 fail + control). 1.x: `w2-style-class-separators.test.tsx` (also broken).

## Negative results (verified working — do not re-hunt)

- seroval exotic values (Map/Set/Date/BigInt/undefined/NaN/-0/circular) round-trip in resumed SSR data.
- `<textarea>`/`<title>` user content escaped; boolean-false attrs dropped consistently server+client; `onCompleteShell`/`onCompleteAll` order correct with zero async.
- Class instances with prototype getters track/notify; `Object.defineProperty` inside a setter notifies `in`-tracking; `createProjection` selection pattern works; `deep()` reruns on new nested keys; `createOptimisticStore` plain-form revert-on-flush is intended (tested at createOptimisticStore.test.ts:30-37).
- `flush()` nesting/throw hygiene; `runWithOwner`/`getOwner`/`getObserver`; context snapshots through memos/roots; keyed:false mapArray shrink/grow/reorder; #2759 and #2761/#2762 fixes hold.
- Loading release on mid-flight unmount; `refresh()` no fallback flash; revalidation rejection through initialized Loading → Errored with original identity (truthy errors); `action()` atomicity/timeline/arg-passing.
- Direct `value={undefined}` (compiler-guarded ?? ""); spread handler removal/swap; class string↔object↔array transitions; For fallback↔items; Show keyed with 0; Switch/Match rearrange; Dynamic tag↔component with reactive props; Portal delegated events + `_$host` retargeting; ShadowRoot delegation; SVG `xlink:href`; checkbox/option/video property toggles; `img src={undefined}` removes attr.
- `<style>`/`<script>` dynamic children are raw text (intended rawtext semantics, matches React/1.x); `bool:`/`attr:` spread prefixes render literally on both sides (no divergence).

## Not covered

Hydration (SSR→client handoff: node claiming, event replay, out-of-order chunk application, lazy hydration, hydration-mismatch tolerance) — the deep-dive did not complete. Recommended as the next wave.
