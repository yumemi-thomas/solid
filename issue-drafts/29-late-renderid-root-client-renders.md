# 2.0.0-beta.17: a later `renderId` root is client-rendered instead of hydrating its server DOM

### Describe the bug

After one root finishes hydrating, Solid marks the global hydration runtime as done. A later call to `hydrate()` for a different `renderId` takes the client-render path instead of claiming that root's server DOM.

This breaks delayed or visibility-triggered islands — precisely the pattern `renderId` exists for. The second root ends up interactive, and because the reconstructed DOM serializes identically to the server DOM, nothing looks wrong on screen. But its nodes were rebuilt from scratch, losing browser state, focus/selection, element identity, and any third-party state attached to the server nodes.

### Your Example Website or App

_StackBlitz link to be added — paste the code below into `src/repro.tsx` of the standard SolidJS Vite template (`solid-js@2.0.0-beta.17`, `@solidjs/web@2.0.0-beta.17`, `jsxImportSource: "@solidjs/web"`) and load it as the entry module; it logs `PASS`/`FAIL` with expected vs actual to the browser console. `index.html` only needs the two empty island mount points: `<div id="island-a"></div><div id="island-b"></div>`._

The repro server-renders two independent counter islands (each with its own `renderId`, as `renderToString(..., { renderId })` emits them), hydrates island A immediately and island B 30 ms later — modeling an island that hydrates on visibility or after its chunk loads — then checks whether island B's server button was claimed or rebuilt.

```tsx
import { hydrate } from "@solidjs/web";
import { createSignal, flush } from "solid-js";

// Two independently streamed counter islands whose output matches the
// serialized markup below (static "a:" / "b:" text plus a dynamic
// marker-pair slot for the count).
const IslandA = () => {
  const [count, setCount] = createSignal(0);
  return (
    <div>
      <button onClick={() => setCount(c => c + 1)}>a:{count()}</button>
    </div>
  );
};
const IslandB = () => {
  const [count, setCount] = createSignal(0);
  return (
    <div>
      <button onClick={() => setCount(c => c + 1)}>b:{count()}</button>
    </div>
  );
};

const islandA = document.getElementById("island-a")!;
const islandB = document.getElementById("island-b")!;

globalThis._$HY = { events: [], completed: new WeakSet(), r: {} };

// Server output of renderToString with renderId "ia" / "ib":
islandA.innerHTML = '<div _hk=ia0><button>a:<!--$-->0<!--/--></button></div>';
islandB.innerHTML = '<div _hk=ib0><button>b:<!--$-->0<!--/--></button></div>';

const serverButtonB = islandB.querySelector("button");

hydrate(IslandA, islandA, { renderId: "ia" });
// island B hydrates later (e.g. on visibility / after its chunk loads)
await new Promise(resolve => setTimeout(resolve, 30));
hydrate(IslandB, islandB, { renderId: "ib" });
flush();

console.log(
  "island B keeps server node identity:",
  islandB.querySelector("button") === serverButtonB
    ? "PASS"
    : "FAIL — the button was recreated by a client render"
);
```

### Steps to Reproduce the Bug or Issue

1. Load the page with the repro module and open the browser console.
2. Island A hydrates immediately with `renderId: "ia"` and completes.
3. Island B hydrates 30 ms later with `renderId: "ib"` against its own untouched server DOM.
4. On 2.0.0-beta.17 the browser console logs:

```text
island B keeps server node identity: FAIL — the button was recreated by a client render
```

The page still shows `b:0` — the elements serialize the same — but node identity differs: island B was rendered from scratch instead of claiming its server DOM.

### Expected behavior

Each `hydrate(..., { renderId })` call claims the server DOM belonging to that independent render ID, even when roots begin hydration at different times:

```text
island B keeps server node identity: PASS
```

### Screenshots or Videos

_No response_

### Platform

- OS: macOS
- Browser: Chrome
- Version: 2.0.0-beta.17 (re-verified at `next` @ `a51cac19`)

### Additional context

Root cause: `@dom-expressions/runtime/src/client.js` treats hydration completion as global:

```js
if (globalThis._$HY.done)
  return render(code, element, [...element.childNodes], options);
```

The first root eventually sets `globalThis._$HY.done = true`, so later roots can never hydrate. This conflicts with the `@solidjs/web` API documentation describing `renderId` as the mechanism for multiple hydration roots.

Suggested fix direction: track hydration completion per render ID/root rather than using one global terminal bit, or allow `hydrate()` to start a new scoped hydration session when the requested `renderId` has not yet been consumed.

Verified in the repo's vitest jsdom harness; the inline code above is the same sequence (a single-island control with `renderId` hydrates fine — only the *later* root falls into the client-render path).

## Does this exist in Solid 1.x?

**Not directly comparable — the 2.0 hydration lifecycle implementation is new.** Solid 1.x documents multiple isolated hydration roots via `renderId`, so this is an important compatibility scenario for the same public API.
