# @solidjs/signals

## 2.0.0-beta.14

### Patch Changes

- 79e246e: Fix Loading boundary child flattening so settled async memo reads converge with `latest()`.
- Add store return tuple type aliases and harden store draft writes against prototype pollution keys.

## 2.0.0-beta.13

### Patch Changes

- 157dfe2: Pass an error accessor to error boundary fallbacks so repeated async errors from the same captured source update reactively.
- 4404f9f: Add an opt-in `isPending(fn, true)` render guard mode that lets pending reads follow the Loading path.

## 2.0.0-beta.12

### Patch Changes

- 0a7c278: Document the mode-specific callback shapes for mapArray and For.
- 12f15a2: Align control-flow callback values with their keying mode so stable rows receive raw values and index-owned rows receive accessors only where the value can change.

## 2.0.0-beta.11

### Patch Changes

- cf62254: Throw a dev-mode error when refresh is called with an unbranded target.
- e41186c: Drop stale dependencies from async memos after their pending result settles.
- 02ec407: Prevent pending async reads from escaping when refreshing an optimistic accessor with an active override.
- e16371f: Reduce effect creation overhead by sharing status notification logic, registering effect cleanups lazily, and avoiding generic store proxy work for tracked reads of absent plain-object properties.
- 7d4d0c3: Optimize pending node commits for the common single-source update path.
- 005c9fb: Improve merge and omit performance for store utility hot paths.
- d2529e3: Redesign refresh to invalidate a single explicit target without reading accessor values.
- 7d4d0c3: Add scoped synchronous flushing and skip no-op status work.
- d42f112: perf(store): split `applyState` into fast/slow paths and tighten store hot-path

  `applyState` now dispatches at every (recursive) call between a `applyStateFast`
  body for plain stores and an `applyStateSlow` body for stores with override or
  optimistic-override slots set. The fast body never calls `getOverrideValue` and
  never branches on a `fastPath` flag, so V8 sees a tighter, more inlinable shape
  in the overwhelmingly common case. Validated end-to-end with UIBench: ~18–21%
  total render time improvement, with no regression in `js-framework-benchmark`.

  Also:
  - `isWrappable` restructured for an early-return hot path on the common
    `null` / non-object cases.
  - `createStoreProxy` now only stamps `STORE_CUSTOM_PROTO` when the prototype
    is non-trivial, avoiding the extra slot on the default object/array path.

- e16371f: Performance: add `CONFIG_SYNC` opt-in for sync-only computeds/effects. New `sync?: boolean` option on `MemoOptions`/`EffectOptions` skips the async-shape probe in `recompute` for nodes that provably never return Promise/AsyncIterable. Compiler-emitted `_$effect` and `_$memo` (via `@solidjs/web`'s `effect`/`memo` wrappers) opt in by default — `01_run1k` mean −0.62 ms and `08_create1k-after1k_x2` mean −0.80 ms in `js-framework-benchmark`. User-authored `createMemo`/`createEffect`/`createRenderEffect` keep full async-aware behavior unless they explicitly pass `sync: true`. Returning a Promise from a `sync: true` node throws `SYNC_NODE_RECEIVED_ASYNC` in dev (production silently stores the unawaited value, by contract).

  Correctness: `flush(fn)` now drains at every nesting level instead of only the outermost. Nested `flush(fn)` calls each honor their own contract — writes inside an inner `flush(fn)` propagate before it returns, rather than being held until the outer `flush(fn)` exits. Microtask scheduling and arg-less `flush()` are unchanged. Code that depended on the old hold-until-outermost behavior should switch to a harness-layer depth counter (see `js-reactivity-benchmark`'s `r3` / `r3-solid-target` adapters for the pattern).

## 2.0.0-beta.10

### Patch Changes

- 59dd11f: Docs prep for the 2.0 reference auto-generation pass: backfill JSDoc examples on previously-undocumented public APIs (`getObserver`, `isDisposed`, `createRenderEffect`, `onCleanup`, `createErrorBoundary`, `createLoadingBoundary`, `createRevealOrder`, `flatten`, `enableExternalSource`, `NotReadyError`, `NoHydration`, `Hydration`, `isServer`, `isDev`); normalize inline JSDoc code fences to `@example` tags on the JSX components (`<For>`, `<Repeat>`, `<Switch>`, `<Errored>`, `<Reveal>`, `dynamic`, `<Dynamic>`); and tag cross-package wiring / compiler-emitted exports with `@internal` so the doc generator can hide them from the user-facing surface (`getContext`, `setContext`, `createOwner`, `getNextChildId`, `peekNextChildId`, `enforceLoadingBoundary`, `sharedConfig`, `enableHydration`, `NoHydrateContext`, `$DEVCOMP`, `$PROXY`, `$REFRESH`, `$TRACK`, `$TARGET`, `$DELETED`, `ssr*` helpers, `escape`, `resolveSSRNode`, `mergeProps`, `ssrHandleError`, `ssrRunInScope`). Also extends the `equals` field JSDoc on `SignalOptions` / `MemoOptions` to mention `isEqual` as the default.

## 2.0.0-beta.9

## 2.0.0-beta.8

### Patch Changes

- 34c65b8: CSR: async reads without a `Loading` ancestor no longer throw. The root mount now participates in transitions — when uncaught async surfaces during initial render, the root DOM attach is withheld until all pending settles and then attaches atomically. On the no-async happy path, `render()` still attaches synchronously before returning (via an internal tail `flush()`).

  **New `schedule` option on effects**

  `@solidjs/signals` exposes a new `schedule?: boolean` option on `EffectOptions`. When `true`, the initial effect callback is enqueued through the effect queue (the same path user effects already take) instead of running synchronously at creation. This lets the initial run participate in transitions — if any source bails during the compute phase, the callback is held until the transition settles.

  ```ts
  createRenderEffect(
    () => source(),
    v => {
      /* runs after flush, deferred by any pending transition */
    },
    { schedule: true }
  );
  ```

  `@solidjs/web`'s `render()` uses this option internally for its top-level insert, which is what enables permissive top-level async in CSR.

  **Dev diagnostic**

  `ASYNC_OUTSIDE_LOADING_BOUNDARY` is now a non-halting `console.warn` (severity downgraded from `error` to `warn`). With deferred-mount the runtime is correct; the diagnostic is an informative FYI rather than a correctness failure. The warning only fires during the synchronous body of `render()` / `hydrate()` — post-mount transitions (including lazy route changes) run under their own transitions with the guard off and do not emit this warning.

  Placing a `Loading` boundary remains the right tool when you want explicit fallback UI or partial progressive mount.

  **Known limitation: multi-phase async**

  Multi-phase async flows — for example, a `lazy()` component whose resolved body reads a second pending async memo — may still reveal partial DOM between waves. This is because the scheduler currently nulls `activeTransition` before running the completing flush's restored queues; a new transition started by recomputes during that phase does not re-stash already-restored callbacks. Single-wave nested async (including static siblings alongside a pending descendant) commits atomically. The multi-phase case is tracked as a follow-up; the recommended workaround today is to place a `Loading` boundary around multi-phase async subtrees.

## 2.0.0-beta.7

### Patch Changes

- 5acf0ee: Allow partial initial values for derived stores/projections by accepting `Partial<T>` for the seed parameter
