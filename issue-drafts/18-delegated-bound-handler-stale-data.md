# 2.0.0-beta.17: a delegated bound handler `[fn, data]` leaks its data to a later handler on the same element

### Describe the bug

When a delegated event handler is set to the bound form `onClick={[fn, data]}` and later reactively swapped for a plain handler `fn2`, `fn2` is invoked as `fn2(data, event)` — it receives the stale bound data as its first argument instead of the event. Even removing the handler entirely and later adding a fresh plain handler resurrects the ancient data.

This is easy to hit in any list/table UI where a row initially passes its data through a bound delegated click handler and then switches to a generic handler — e.g. after the row enters edit mode:

```tsx
<button onClick={editing() ? handleEditorClick : [openRow, row.id]}>Open</button>
```

After the switch, `handleEditorClick` should receive the click event. Instead it is invoked as if it were still a bound handler and receives the old `row.id` as its first argument. In a real table this can open, edit, or delete the wrong row.

### Your Example Website or App

_StackBlitz link to be added — paste the code below into `src/App.tsx` of the standard SolidJS Vite template (`solid-js@2.0.0-beta.17`, `@solidjs/web@2.0.0-beta.17`, `jsxImportSource: "@solidjs/web"`)._

A row button's spread props start with the bound form `onClick={[openRow, { id: 1 }]}`; **enter edit mode** reactively swaps it to a plain handler. The plain handler itself renders the verdict: green **PASS** if it received just the event, red **FAIL** with what it actually received.

```tsx
import { createSignal, flush, Show } from "solid-js";

type Verdict = { ok: boolean; actual: string };

export default function App() {
  const [viewing, setViewing] = createSignal("");
  const [editing, setEditing] = createSignal(false);
  const [verdict, setVerdict] = createSignal<Verdict>();

  // Bound handler used while the row is in view mode.
  function openRow(data: { id: number }, e: Event) {
    setViewing(`openRow(${JSON.stringify(data)}, ${e instanceof Event ? "Event" : String(e)})`);
  }

  // Plain handler installed after the swap — it should receive just the event.
  function handleEditorClick(...args: unknown[]) {
    const first = args[0];
    setVerdict({
      ok: args.length === 1 && first instanceof Event,
      actual: `handleEditorClick received ${args.length} arg(s); first = ${
        first instanceof Event ? "Event" : JSON.stringify(first)
      }`
    });
  }

  // The row's props are spread onto the button; the delegated onClick starts in bound form.
  const [rowProps, setRowProps] = createSignal<any>({ onClick: [openRow, { id: 1 }] });

  function enterEditMode() {
    setRowProps({ onClick: handleEditorClick }); // reactively swap bound → plain
    flush();
    setEditing(true);
  }

  return (
    <main style={{ "font-family": "system-ui", padding: "16px" }}>
      <h2>Delegated bound handler leaks its data to a later plain handler</h2>
      <button {...rowProps()}>Open row</button>{" "}
      <button onClick={enterEditMode} disabled={editing()}>
        enter edit mode
      </button>
      <p>{viewing()}</p>
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
            <div>expected: handleEditorClick received 1 arg(s); first = Event</div>
            <pre>actual: {v().actual}</pre>
          </section>
        )}
      </Show>
    </main>
  );
}
```

### Steps to Reproduce the Bug or Issue

1. Click **Open row**. The bound form works as designed — the status line shows `openRow({"id":1}, Event)`.
2. Click **enter edit mode**. The row's spread props swap the delegated `onClick` from `[openRow, { id: 1 }]` to the plain `handleEditorClick`.
3. Click **Open row** again. On 2.0.0-beta.17 the page shows:

```text
FAIL - bug reproduced
expected: handleEditorClick received 1 arg(s); first = Event
actual: handleEditorClick received 2 arg(s); first = {"id":1}
```

### Expected behavior

Once a non-array handler is installed, no bound data is passed — the handler receives just the event:

```text
PASS - bug is fixed
expected: handleEditorClick received 1 arg(s); first = Event
actual: handleEditorClick received 1 arg(s); first = Event
```

### Screenshots or Videos

_No response_

### Platform

- OS: macOS
- Browser: Chrome
- Version: 2.0.0-beta.17 (re-verified at `next` @ `a51cac19`)

### Additional context

Root cause: `addEvent` (dom-expressions runtime `client.js:236-241`) sets `node.$$click` / `node.$$clickData` for the array form but never clears `$$clickData` when a later update installs a non-array handler; `eventHandler` dispatches on `data !== undefined` (client.js:718-721), so any handler installed after an array handler on the same element receives the ancient data as its first argument.

Repro test: `packages/solid-web/test/hunt2-delegated-bound-data-stale.spec.tsx` (2 failing — also covers the remove-the-handler-entirely-then-add-a-fresh-one variant, which resurrects the old data the same way).

## Does this exist in Solid 1.x?

**Inconclusive.** Solid 1.x binds direct JSX event handlers once (non-reactive), so the reactive-swap path that triggers this bug has no direct 1.x equivalent (`hunt-1x-checks/checks/w2-dom-bound-data-stale.test.tsx` shows the swap simply doesn't happen in 1.x). The defect is in 2.0's reactive-handler update path.
