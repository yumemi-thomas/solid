# 2.0.0-beta.17: swapping/moving store rows clones previously-edited rows — store identity is lost

### Describe the bug

The canonical in-place row swap — `const t = s.list[i]; s.list[i] = s.list[j]; s.list[j] = t` — works for rows that were never written, but any row that was **previously edited** (has a `STORE_OVERRIDE`) is *cloned* rather than moved. Two consequences:

1. A keyed `<For>` sees a brand-new object identity for the moved row and tears down + rebuilds that row's DOM (losing focus, input state, component state).
2. Any component still holding the old row proxy is silently detached — store writes to the row no longer reach it, and vice versa.

This hits any drag-and-drop reorder over a `createStore` list where users edit before reordering. A kanban board is the typical shape:

```ts
setBoard(s => {
  s.cards[0].title = "Draft PR"; // edited card now carries an override
});
setBoard(s => {
  const moved = s.cards[0];      // drag: swap cards 0 and 1
  s.cards[0] = s.cards[1];
  s.cards[1] = moved;
});
```

After the move, keyed rows can remount, and a component holding the pre-swap card proxy no longer observes future writes — focus, local state, selection, or inline editor state disappears only for cards that were edited before being moved. The boundary of the bug, for contrast: an untouched row keeps its proxy identity across the exact same swap — only the previously-edited row is cloned.

### Your Example Website or App

_StackBlitz link to be added — paste the code below into `src/App.tsx` of the standard SolidJS Vite template (`solid-js@2.0.0-beta.17`, `@solidjs/web@2.0.0-beta.17`, `jsxImportSource: "@solidjs/web"`)._

The repro edits row 1 (so it carries an override), captures its row proxy the way a component would, swaps the two rows in place, then writes to the moved row through the store. It shows a green **PASS — bug is fixed** banner if the captured proxy moved with the row and still observes the write, or a red **FAIL — bug reproduced** banner otherwise.

```tsx
import { createSignal, createStore, flush, Show } from "solid-js";

type Verdict = { ok: boolean; actual: string };

export default function App() {
  const [state, setState] = createStore({
    list: [
      { id: 1, v: "a" },
      { id: 2, v: "b" }
    ]
  });
  const [verdict, setVerdict] = createSignal<Verdict>();

  function editThenSwap() {
    // edit row 1 so it carries an override
    setState(s => {
      s.list[1].v = "b1";
    });
    flush();
    const captured = state.list[1]; // e.g. the row proxy handed to a component

    // canonical in-place swap of rows 0 and 1
    setState(s => {
      const tmp = s.list[1];
      s.list[1] = s.list[0];
      s.list[0] = tmp;
    });
    flush();

    // the edited row, now at index 0, should be the same proxy captured before the swap
    const identityPreserved = state.list[0] === captured;

    // write through the store to the logical row now at index 0
    setState(s => {
      s.list[0].v = "b2";
    });
    flush();

    setVerdict({
      ok: identityPreserved && captured.v === "b2",
      actual: [
        `state.list[0] === captured: ${identityPreserved} (expected true — the swap moves the same proxy)`,
        `store row v: "${state.list[0].v}"; captured proxy v: "${captured.v}" (expected "b2" on both)`
      ].join("\n")
    });
  }

  return (
    <main style={{ "font-family": "system-ui", padding: "16px" }}>
      <h2>Row swap detaches an edited row's proxy</h2>
      <p>rows: {JSON.stringify(state.list)}</p>
      <button onClick={editThenSwap}>edit row 1, swap rows, write to moved row</button>
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

1. Click **edit row 1, swap rows, write to moved row**. The handler edits `state.list[1].v` to `"b1"`, captures that row's proxy, swaps rows 0 and 1 with the classic temp-variable pattern, then writes `"b2"` to the moved row through the store.
2. On 2.0.0-beta.17 the page shows:

```text
FAIL - bug reproduced
state.list[0] === captured: false (expected true — the swap moves the same proxy)
store row v: "b2"; captured proxy v: "b1" (expected "b2" on both)
```

The edited row was cloned by the swap: the captured proxy is permanently detached and never observes later store writes to that row.

### Expected behavior

Moving a store-valued row through a draft assignment preserves its proxy identity and keeps captured references connected — as in Solid 1.x (verified 1.9.14: identity is preserved and the captured proxy observes the write):

```text
PASS - bug is fixed
state.list[0] === captured: true (expected true — the swap moves the same proxy)
store row v: "b2"; captured proxy v: "b2" (expected "b2" on both)
```

### Screenshots or Videos

_No response_

### Platform

- OS: macOS
- Browser: Chrome
- Version: 2.0.0-beta.17 (re-verified at `next` @ `a51cac19`)

### Additional context

Root cause: draft assignments route through `unwrapStoreValue` (set trap, `packages/solid-signals/src/store/store.ts:570`); for a subtree with a `STORE_OVERRIDE`, `unwrapStoreValue` (`store.ts:164-185`) materializes a fresh plain clone instead of returning a stable underlying value, severing the row from its existing proxy/nodes.

Distinct from #2825 (reconcile reading `STORE_NODE`).

Repro test: `packages/solid-signals/tests/store/hunt2-draft-reassign-identity.test.ts` (2 failing).

## Does this exist in Solid 1.x?

**Regression.** Verified against 1.9.14 (`hunt-1x-checks/checks/w2-store-draft-reassign-identity.test.ts`): identity is preserved and the captured proxy stays connected.
