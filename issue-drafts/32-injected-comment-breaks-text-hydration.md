# 2.0.0-beta.17: an injected comment can permanently stale or duplicate a hydrated text slot

### Describe the bug

A comment inserted into server HTML by a browser extension, CDN/edge rewriter, analytics tool, or A/B testing system can permanently break a reactive text slot during hydration. These tools inject comments routinely, the page hydrates without any warning, and the breakage only surfaces on the first signal update.

There are two manifestations:

1. **Sole text child** (`<p>{text()}</p>`): updates are written into the injected comment's `data`, so the visible server text stays stale forever.
2. **Marker-pair slot** (`Count: <!--$-->{count()}<!--/-->`): the comment shifts positional claiming. Solid creates a fresh detached text node but leaves the server text orphaned, so the first update renders duplicated content next to it.

A control with unmodified server HTML (no injected comment) passes both scenarios — the injected comment is the sole trigger.

### Your Example Website or App

_StackBlitz link to be added — paste the code below into `src/repro.tsx` of the standard SolidJS Vite template (`solid-js@2.0.0-beta.17`, `@solidjs/web@2.0.0-beta.17`, `jsxImportSource: "@solidjs/web"`) and load it as the entry module; it logs `PASS`/`FAIL` with expected vs actual to the browser console. `index.html` only needs an empty mount point: `<div id="app"></div>`._

The server HTML in each variant is the exact `renderToString` output of the hydrated component, with one `<!--injected-->` comment added the way third-party rewriters do. Run each variant on a fresh page load (common setup first):

```tsx
import { hydrate } from "@solidjs/web";
import { createSignal, flush } from "solid-js";

const container = document.getElementById("app")!;
globalThis._$HY = { events: [], completed: new WeakSet(), r: {} };
```

Variant 1 — sole text child:

```tsx
// Server output of <div><p>{text()}</p></div> with text = "hello",
// plus a comment injected by a proxy/extension:
container.innerHTML = '<div _hk=0><p><!--injected-->hello</p></div>';

let setText!: (value: string) => void;
hydrate(() => {
  const [text, set] = createSignal("hello");
  setText = set;
  return <div><p>{text()}</p></div>;
}, container);

setText("world");
flush();

const pText = container.querySelector("p")!.textContent;
console.log(
  "sole text child updated:",
  pText === "world" ? "PASS" : `FAIL — expected "world", got ${JSON.stringify(pText)}`
);
```

Variant 2 — marker-pair slot:

```tsx
// Server output of <div><button>Count: {count()}</button></div> with count = 0,
// plus a comment injected between the hydration markers:
container.innerHTML =
  '<div _hk=0><button>Count: <!--$--><!--injected-->0<!--/--></button></div>';

let setCount!: (value: number) => void;
hydrate(() => {
  const [count, set] = createSignal(0);
  setCount = set;
  return <div><button onClick={() => {}}>Count: {count()}</button></div>;
}, container);

setCount(1);
flush();

const buttonText = container.querySelector("button")!.textContent;
console.log(
  "marker-pair slot updated:",
  buttonText === "Count: 1" ? "PASS" : `FAIL — expected "Count: 1", got ${JSON.stringify(buttonText)}`
);
```

### Steps to Reproduce the Bug or Issue

1. Load the page with variant 1 and open the browser console: hydration succeeds silently, the page shows `hello`, then the signal updates to `"world"`.
2. Reload with variant 2: hydration succeeds silently, the button shows `Count: 0`, then the count updates to `1`.
3. On 2.0.0-beta.17 the browser console logs:

```text
sole text child updated: FAIL — expected "world", got "hello"
marker-pair slot updated: FAIL — expected "Count: 1", got "Count: 01"
```

In variant 1 the update was written into the injected comment's data — the DOM ends as `<p><!--world-->hello</p>`, so the user forever sees the stale value. In variant 2 the orphaned server text is duplicated next to the fresh client text node — `Count: <!--$--><!--injected-->01<!--/-->`.

### Expected behavior

Hydration either claims the correct text node despite ignorable comments or detects the mismatch and safely replaces/reconciles the slot. Later updates must not remain stale or duplicate server content:

```text
sole text child updated: PASS
marker-pair slot updated: PASS
```

### Screenshots or Videos

_No response_

### Platform

- OS: macOS
- Browser: Chrome
- Version: 2.0.0-beta.17 (re-verified at `next` @ `a51cac19`)

### Additional context

Root cause, variant 1: the string fast path in `insertExpression` (dom-expressions `src/client.js:779`) assumes `parent.firstChild` is the owned text node:

```js
parent.firstChild.data = value;
```

With an injected comment first, every update is written into the *comment's* data.

Root cause, variant 2: the multi-node `normalize()` path (dom-expressions `src/client.js:824-828`) claims text nodes positionally from the nodes between the markers. The injected comment occupies the expected position, so a fresh detached text node is created instead of claiming the server text node. The server text is orphaned (never part of `current`), and the first update reconciles the fresh node in next to it — duplicated content.

Suggested fix direction: track the actual claimed text node rather than relying on `firstChild`, and either skip non-marker comments during positional text claiming or force a controlled mismatch recovery that removes the orphaned server node.

Both variants verified in the repo's vitest jsdom harness (an unmodified-HTML control passes); the inline code above is the same sequence.

## Does this exist in Solid 1.x?

**Not compared.** This is primarily hydration robustness against common third-party HTML mutation.
