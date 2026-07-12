# 2.0.0-beta.17: `ssrSource: "hybrid"` drops synchronous store mutations after hydration

### Describe the bug

A function-form store with `ssrSource: "hybrid"` correctly adopts its server value during hydration, but its first client-side synchronous recomputation silently loses every draft mutation.

For example, a profile store initialized from SSR data should run its client synchronizer after hydration:

```ts
const [profile] = createStore(
  draft => {
    draft.name = readClientName();
  },
  { name: "initial" },
  { ssrSource: "hybrid" }
);
```

Instead, the client compute runs against a shadow draft and returns `undefined`. Because only async iterables activate the real draft, the mutated shadow is discarded and `profile.name` silently stays at the old server value — the function demonstrably ran, but its writes went nowhere.

### Your Example Website or App

_StackBlitz link to be added — paste the code below into `src/repro.tsx` of the standard SolidJS Vite template (`solid-js@2.0.0-beta.17`, `@solidjs/web@2.0.0-beta.17`, `jsxImportSource: "@solidjs/web"`) and load it as the entry module; it logs `PASS`/`FAIL` with expected vs actual to the browser console. No `index.html` markup is needed._

The repro drives the client hydration runtime through `sharedConfig`, which is a public export of `solid-js` — `startHydration()` injects exactly the serialized envelope format the server emits. The final `stopHydration(); flush()` models `hydrate()` completion: the moment the runtime flips `sharedConfig.hydrating` off and runs deferred computations.

```tsx
import { createRoot, createStore, flush, sharedConfig } from "solid-js";

let hydrationData: Record<string, any> = {};
function startHydration(data: Record<string, any>) {
  hydrationData = data;
  sharedConfig.hydrating = true;
  (sharedConfig as any).has = (id: string) => id in hydrationData;
  (sharedConfig as any).load = (id: string) => hydrationData[id];
  (sharedConfig as any).gather = () => {};
}
function stopHydration() {
  sharedConfig.hydrating = false;
  (sharedConfig as any).has = undefined;
  (sharedConfig as any).load = undefined;
  (sharedConfig as any).gather = undefined;
}

// Server serialized the store as { name: "server" }.
startHydration({ t0: { v: { name: "server" }, s: 1 } });

let store: any;
createRoot(() => {
  [store] = createStore(
    draft => {
      draft.name = "client"; // synchronous client synchronizer
    },
    { name: "initial" },
    { ssrSource: "hybrid" }
  );
}, { id: "t" });
flush();
console.log(
  "hydrating store adopts server value:",
  store.name === "server" ? "PASS" : `FAIL — expected "server", got ${JSON.stringify(store.name)}`
);

stopHydration();
flush();
console.log(
  "post-hydration sync draft write applied:",
  store.name === "client" ? "PASS" : `FAIL — expected "client", got ${JSON.stringify(store.name)}`
);
```

### Steps to Reproduce the Bug or Issue

1. Load the page with the repro module and open the browser console.
2. The repro hydrates a function-form `createStore` with `ssrSource: "hybrid"` against a resolved server value `{ name: "server" }`; the function synchronously mutates its draft (`draft.name = "client"`) and returns nothing.
3. Hydration finishes (`stopHydration()` + `flush()`), which is when the client computation is supposed to take over.
4. On 2.0.0-beta.17 the browser console logs:

```text
hydrating store adopts server value: PASS
post-hydration sync draft write applied: FAIL — expected "client", got "server"
```

The store still contains the server value even though the client function ran.

### Expected behavior

`hybrid` should use the serialized value while hydrating, then execute the client computation against the real store after hydration — a synchronous draft mutation must be visible after the hydration transition:

```text
hydrating store adopts server value: PASS
post-hydration sync draft write applied: PASS
```

### Screenshots or Videos

_No response_

### Platform

- OS: macOS
- Browser: Chrome
- Version: 2.0.0-beta.17 (re-verified at `next` @ `a51cac19`)

### Additional context

Root cause: in `hydrateStoreLikeFn()` (`packages/solid/src/client/hydration.ts`), the `hybrid` branch always runs the post-hydration client function against `createShadowDraft(draft)`:

```ts
const { proxy, activate } = createShadowDraft(draft);
const r = fn(proxy);
return isAsyncIterable(r) ? wrapFirstYield(r, activate) : r;
```

`activate()` is called only by `wrapFirstYield()` for an async iterable. A synchronous function therefore mutates only the JSON shadow, and the mutations are never replayed to `draft`.

Suggested fix direction: retain/apply a patch log for synchronous results, or avoid the shadow path unless the computation actually yields an async iterable. The same shared helper backs `createProjection` and `createOptimisticStore`, so they should receive regression coverage too.

## Does this exist in Solid 1.x?

**Not applicable — new 2.0 API.** `ssrSource: "hybrid"` (and function-form `createStore`) is a Solid 2.0 API with no 1.x counterpart.
