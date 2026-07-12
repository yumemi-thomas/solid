# 2.0.0-beta.17: one stale pre-hydration event blocks every later queued event

### Describe the bug

If the hydration event queue starts with an event whose target disappeared before hydration, event replay stops at that entry forever. Later events for live nodes that hydrated successfully are never replayed.

This happens in a perfectly ordinary streaming sequence: a user clicks a streamed `<Loading>` fallback, the server fragment replaces that fallback before client hydration reaches it, and then the user clicks a still-live control. The stale fallback event becomes a permanent head-of-line blocker — the click on the live control is captured, queued, and then silently lost.

### Your Example Website or App

_StackBlitz link to be added — paste the code below into `src/repro.tsx` of the standard SolidJS Vite template (`solid-js@2.0.0-beta.17`, `@solidjs/web@2.0.0-beta.17`, `jsxImportSource: "@solidjs/web"`) and load it as the entry module; it logs `PASS`/`FAIL` with expected vs actual to the browser console. `index.html` only needs an empty mount point: `<div id="app"></div>`._

The synthetic `_$HY.events` pushes replicate exactly what the server-emitted event-capture script queues when the user clicks before hydration completes: first a click whose target is a now-detached node (the replaced `<Loading>` fallback button), then a click on button B, which is still live.

```tsx
import { hydrate } from "@solidjs/web";

const container = document.getElementById("app")!;
container.innerHTML = "<div _hk=0><button>A</button><button>B</button></div>";
globalThis._$HY = { events: [], completed: new WeakSet(), r: {} };

// 1) pre-hydration click on a streamed fallback button that the server
//    fragment already replaced — its node is detached now
const removed = document.createElement("button");
// 2) pre-hydration click on button B, which is still in the DOM
const buttonB = container.querySelectorAll("button")[1];

globalThis._$HY.events.push([removed, new MouseEvent("click", { bubbles: true })]);
globalThis._$HY.events.push([buttonB, new MouseEvent("click", { bubbles: true })]);

const clicks: string[] = [];
hydrate(
  () => (
    <div>
      <button onClick={() => clicks.push("A")}>A</button>
      <button onClick={() => clicks.push("B")}>B</button>
    </div>
  ),
  container
);

await new Promise(resolve => setTimeout(resolve, 30));
console.log(
  "queued live event replayed:",
  JSON.stringify(clicks) === JSON.stringify(["B"])
    ? "PASS"
    : `FAIL — expected ["B"], got ${JSON.stringify(clicks)}`
);
```

### Steps to Reproduce the Bug or Issue

1. Load the page with the repro module and open the browser console.
2. The event queue holds two pre-hydration clicks: one targeting a detached node, then one targeting live button B.
3. Hydration completes; both buttons are hydrated and interactive.
4. On 2.0.0-beta.17 the browser console logs:

```text
queued live event replayed: FAIL — expected ["B"], got []
```

No queued event is ever replayed — the stale head entry blocks the queue permanently, and the user's click on B is lost.

### Expected behavior

Events targeting disconnected nodes that can no longer hydrate are discarded so replay can continue to later valid events — the queued click on live button B fires:

```text
queued live event replayed: PASS
```

### Screenshots or Videos

_No response_

### Platform

- OS: macOS
- Browser: Chrome
- Version: 2.0.0-beta.17 (re-verified at `next` @ `a51cac19`)

### Additional context

Root cause: `runHydrationEvents()` examines only the first event and returns without shifting it when its target is not in the completed set:

```js
const [el, e] = events[0];
if (!completed.has(el)) return;
events.shift();
```

There is no disconnected-target escape, so the queue can never advance past a stale entry.

Suggested fix direction: when `!completed.has(el)` and `!el.isConnected`, remove the stale entry and continue. Still return for connected targets that may legitimately hydrate later, preserving event order where possible.

Verified in the repo's vitest jsdom harness; the inline code above is the same sequence (live clicks dispatched *after* hydration still work — only the queued replay is blocked).

## Does this exist in Solid 1.x?

**Not yet compared** with 1.9.14. The defect is independently valid because it loses a queued user interaction on a live, hydrated control.
