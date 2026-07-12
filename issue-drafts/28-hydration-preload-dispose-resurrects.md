# 2.0.0-beta.17: disposing `hydrate()` during root-module preload does not cancel the later mount

### Describe the bug

When hydration must preload modules from the root `_assets` map, `hydrate()` delays the actual mount until those dynamic imports resolve. Calling the returned disposer during that delay does not cancel anything. Once the imports resolve, Solid mounts the application anyway and attaches live event handlers to a root the caller already disposed.

This resurrects a route or island after navigation/unmount — the exact window where it happens in practice is a slow network: the router disposes the island while its lazy-hydration chunk is still downloading, and when the chunk lands the "unmounted" island comes back to life, retaining owners, effects, and event handlers the application believes are gone.

### Your Example Website or App

_StackBlitz link to be added — paste the code below into `src/repro.tsx` of the standard SolidJS Vite template (`solid-js@2.0.0-beta.17`, `@solidjs/web@2.0.0-beta.17`, `jsxImportSource: "@solidjs/web"`) and load it as the entry module; it logs `PASS`/`FAIL` with expected vs actual to the browser console. `index.html` only needs an empty mount point: `<div id="app"></div>`._

The repro server-renders a small newsletter island whose root `_assets` map points at a module gated behind a promise (standing in for a slow chunk download), disposes the root while the module is still loading, then checks whether the "disposed" island became interactive anyway.

```tsx
import { hydrate } from "@solidjs/web";

const container = document.getElementById("app")!;

// Gate the island's entry module behind a promise we control — this is the
// slow network fetch of the lazy-hydration chunk.
let release!: () => void;
(globalThis as any).__moduleGate = new Promise<void>(resolve => (release = resolve));
const entry = "data:text/javascript,await globalThis.__moduleGate; export default 1";

// Server-rendered markup plus the root asset map that defers the mount.
container.innerHTML = "<div _hk=0><button>Subscribe</button></div>";
(globalThis as any)._$HY = {
  events: [],
  completed: new WeakSet(),
  r: { _assets: { app: entry } }
};

const clicks: string[] = [];
const dispose = hydrate(
  () => <div><button onClick={() => clicks.push("subscribe")}>Subscribe</button></div>,
  container
);

dispose(); // the app unmounts the island while the module is still loading
release(); // ...then the chunk finishes downloading
await new Promise(resolve => setTimeout(resolve, 20));

container.querySelector("button")!.click();
console.log(
  "disposed root stays inert:",
  clicks.length === 0
    ? "PASS"
    : `FAIL — expected [], got ${JSON.stringify(clicks)}`
);
```

### Steps to Reproduce the Bug or Issue

1. Load the page with the repro module and open the browser console.
2. `hydrate()` sees the root `_assets` map and defers the mount behind a dynamic `import()` that has not resolved yet.
3. The repro calls the disposer returned by `hydrate()` during that delay, then lets the module resolve.
4. After the module resolves, it clicks the island's button.
5. On 2.0.0-beta.17 the browser console logs:

```text
disposed root stays inert: FAIL — expected [], got ["subscribe"]
```

The mount ran after disposal: the click handler is live on a root the application already disposed.

### Expected behavior

The disposer returned by `hydrate()` cancels a pending mount. Resolving module preloads after disposal must not create owners, effects, delegated roots, or event handlers:

```text
disposed root stays inert: PASS
```

### Screenshots or Videos

_No response_

### Platform

- OS: macOS
- Browser: Chrome
- Version: 2.0.0-beta.17 (re-verified at `next` @ `a51cac19`)

### Additional context

Root cause: `@dom-expressions/runtime/src/client.js` stores the real disposer only after the preload promise resolves:

```js
let disposer;
p.then(() => {
  disposer = render(code, element, [...element.childNodes], options);
});
return () => disposer && disposer();
```

The early disposer is a no-op, and no cancellation flag is checked by the promise callbacks.

Suggested fix direction: track a `cancelled` flag. The returned disposer should set it immediately; both preload success and failure paths should skip mounting when cancelled. If a race mounts before cancellation is observed, dispose that mount immediately.

Verified in the repo's vitest jsdom harness; the inline code above is the same sequence.

## Does this exist in Solid 1.x?

**Not applicable — architecture-specific to 2.0.** This path depends on the 2.0 root asset preload/hydration integration (`_$HY.r._assets` deferring the mount behind dynamic imports); 1.x has no equivalent.
