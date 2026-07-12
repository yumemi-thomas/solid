# 2.0.0-beta.17: a non-delegated `[fn, data]` handler mutates the user's tuple; a shared tuple passes data as the event

### Describe the bug

For a non-delegated event (e.g. `onMouseEnter`, `onTransitionEnd`), the bound form `[fn, data]` is broken when the same tuple is reused across elements:

1. The runtime writes its wrapper back into the user's array (`handler[0] = wrapper`), **mutating the user's tuple** — `tuple[0] !== fn` after render.
2. A second element sharing the tuple wraps the already-installed wrapper, so its handler is called as `fn(data, data)` — the bound data replaces the event object.

Sharing one tuple is exactly what you do to avoid allocating a new array per render — a design-system component reusing one bound hover handler across repeated buttons, or a memoized handler tuple:

```tsx
const tooltipHandler = [showTooltip, { placement: "top" }] as const;

<button onMouseEnter={tooltipHandler}>Save</button>
<button onMouseEnter={tooltipHandler}>Publish</button>
```

The first render mutates `tooltipHandler[0]`; the second element then wraps the wrapper instead of the original function, so its handler receives the payload as the event argument. The boundary of the bug, for contrast: the **delegated** path (e.g. `onClick`) stores handler and data on the node without touching the user's array, so `onClick={tuple}` works while `onMouseEnter={tuple}` breaks.

### Your Example Website or App

_StackBlitz link to be added — paste the code below into `src/App.tsx` of the standard SolidJS Vite template (`solid-js@2.0.0-beta.17`, `@solidjs/web@2.0.0-beta.17`, `jsxImportSource: "@solidjs/web"`)._

Two toolbar buttons share one `[showTooltip, data]` tuple on `onMouseEnter`. Hovering them renders a verdict banner listing what each hover received plus whether the tuple survived intact: green **PASS** if every hover got a real event and `tooltipHandler[0]` is still the original function, red **FAIL** otherwise.

```tsx
import { createSignal, Show } from "solid-js";

type Verdict = { ok: boolean; actual: string };

export default function App() {
  const [verdict, setVerdict] = createSignal<Verdict>();
  const hovers: { data: unknown; event: unknown }[] = [];

  // One shared tooltip handler for every toolbar button.
  function showTooltip(data: unknown, event: unknown) {
    hovers.push({ data, event });
    const tupleIntact = tooltipHandler[0] === showTooltip;
    setVerdict({
      ok: tupleIntact && hovers.every(h => h.event instanceof Event),
      actual: [
        ...hovers.map(
          (h, i) =>
            `hover ${i + 1}: showTooltip(${JSON.stringify(h.data)}, ${
              h.event instanceof Event ? "Event" : JSON.stringify(h.event)
            })`
        ),
        `tooltipHandler[0] === showTooltip: ${tupleIntact}`
      ].join("\n")
    });
  }

  // One tuple reused across elements to avoid allocating a new array per button
  // (mouseenter is a NON-delegated event).
  const tooltipHandler = [showTooltip, { placement: "top" }] as any;

  return (
    <main style={{ "font-family": "system-ui", padding: "16px" }}>
      <h2>Shared non-delegated bound handler tuple</h2>
      <p>
        Hover <b>Save</b>, then <b>Publish</b> — both share the same{" "}
        <code>[showTooltip, data]</code> tuple on <code>onMouseEnter</code>.
      </p>
      <button onMouseEnter={tooltipHandler}>Save</button>{" "}
      <button onMouseEnter={tooltipHandler}>Publish</button>
      <Show when={verdict()}>
        {v => (
          <section
            style={{
              padding: "12px",
              "margin-top": "12px",
              color: "white",
              background: v().ok ? "#137333" : "#c5221f"
            }}
          >
            <b>{v().ok ? "PASS - bug is fixed" : "FAIL - bug reproduced"}</b>
            <pre>{v().actual}</pre>
          </section>
        )}
      </Show>
    </main>
  );
}
```

### Steps to Reproduce the Bug or Issue

1. Hover **Save**. Its handler still receives `({"placement":"top"}, Event)` correctly — but installing the handlers already overwrote `tooltipHandler[0]` with the runtime's wrapper, so the banner is already red.
2. Hover **Publish**. The second element wrapped the first element's wrapper, so `showTooltip` is called with the bound data in place of the event. On 2.0.0-beta.17 the page shows:

```text
FAIL - bug reproduced
hover 1: showTooltip({"placement":"top"}, Event)
hover 2: showTooltip({"placement":"top"}, {"placement":"top"})
tooltipHandler[0] === showTooltip: false
```

### Expected behavior

Both elements call `fn(data, event)` and the user's tuple is left untouched, as the delegated path already does:

```text
PASS - bug is fixed
hover 1: showTooltip({"placement":"top"}, Event)
hover 2: showTooltip({"placement":"top"}, Event)
tooltipHandler[0] === showTooltip: true
```

### Screenshots or Videos

_No response_

### Platform

- OS: macOS
- Browser: Chrome
- Version: 2.0.0-beta.17 (re-verified at `next` @ `a51cac19`)

### Additional context

Root cause: `addEvent` (dom-expressions runtime `client.js:243`) does `node.addEventListener(name, (handler[0] = e => handlerFn.call(node, handler[1], e)))` — writing the wrapper into the user array, so a second element wraps the first wrapper (`w2(e) → w1(data) → fn(data, data)`).

Same "mutates user objects" family as #2828 (style objects) but a different code path and prop kind.

Repro test: `packages/solid-web/test/hunt2-bound-handler-array-mutation.spec.tsx` (2 failing + a passing delegated-`onClick` control with the same shared tuple).

## Does this exist in Solid 1.x?

**Also broken in 1.x** (not a regression), with a slightly different symptom: verified 1.9.14 (`hunt-1x-checks/checks/w2-dom-bound-array-mutation.test.tsx`) the second element receives `(data, null)` — the event is dropped — and the user tuple is likewise mutated. Long-standing bug in the shared runtime.
