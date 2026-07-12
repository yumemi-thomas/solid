# 2.0.0-beta.17 regression: `snapshot()` breaks root self-cycle identity after a store write

### Describe the bug

Snapshotting a self-referential store after any write creates **two** root objects: the returned root points to a second clone, and the cycle closes around that second clone instead of the returned value.

All the values are correct in both clones, so deep value-equality checks pass and miss the graph-topology corruption entirely — only identity checks (`copy.self === copy`) reveal it. Anything that relies on the copied graph's aliasing (serializers with cycle support, undo/redo stacks, graph diffing) silently gets a different topology than the store holds.

### Your Example Website or App

_StackBlitz link to be added — paste the code below into `src/App.tsx` of the standard SolidJS Vite template (`solid-js@2.0.0-beta.17`, `@solidjs/web@2.0.0-beta.17`, `jsxImportSource: "@solidjs/web"`)._

The repro holds a store whose root references itself (`source.self = source`), performs one write, snapshots, and shows a PASS/FAIL banner listing expected vs actual per assertion — values pass, identity fails.

```tsx
import { createSignal, createStore, flush, Show, snapshot } from "solid-js";

type CaseResult = { label: string; ok: boolean; expected: string; actual: string };
type Verdict = { ok: boolean; report: string };

export default function App() {
  const source: any = { value: 1 };
  source.self = source; // root self-reference

  const [state, setState] = createStore<any>(source);
  const [verdict, setVerdict] = createSignal<Verdict>();

  function writeAndSnapshot() {
    setState(draft => {
      draft.value = 2;
    });
    flush();

    const copy: any = snapshot(state);

    const cases: CaseResult[] = [
      {
        label: "copy.value",
        ok: copy.value === 2,
        expected: "2",
        actual: String(copy.value) // passes — values look right...
      },
      {
        label: "copy.self.value",
        ok: copy.self.value === 2,
        expected: "2",
        actual: String(copy.self.value) // passes — ...so deep value checks miss the corruption
      },
      {
        label: "copy.self === copy",
        ok: copy.self === copy,
        expected: "true (the root self-reference points back at the returned root)",
        actual: String(copy.self === copy) // fails — the cycle closes around a second clone
      },
      {
        label: "copy.self.self === copy.self",
        ok: copy.self.self === copy.self,
        expected: "true",
        actual: String(copy.self.self === copy.self) // passes — the second clone is itself self-cyclic
      }
    ];

    setVerdict({
      ok: cases.every(c => c.ok),
      report: cases
        .map(c => `${c.ok ? "PASS" : "FAIL"}  ${c.label}\n  expected: ${c.expected}\n  actual:   ${c.actual}`)
        .join("\n")
    });
  }

  return (
    <main style={{ "font-family": "system-ui", padding: "16px" }}>
      <h2>snapshot() root self-cycle identity</h2>
      <p>value: {state.value}</p>
      <button onClick={writeAndSnapshot}>write and snapshot</button>
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
            <pre>{v().report}</pre>
          </section>
        )}
      </Show>
    </main>
  );
}
```

### Steps to Reproduce the Bug or Issue

1. Click **write and snapshot**. It performs one plain store write (`draft.value = 2`), flushes, and snapshots the self-referential store.
2. On 2.0.0-beta.17 the page shows the value checks passing while the root identity check fails:

```text
FAIL - bug reproduced
PASS  copy.value
  expected: 2
  actual:   2
PASS  copy.self.value
  expected: 2
  actual:   2
FAIL  copy.self === copy
  expected: true (the root self-reference points back at the returned root)
  actual:   false
PASS  copy.self.self === copy.self
  expected: true
  actual:   true
```

The graph changed from one self-cyclic object to a root wrapper pointing at a second self-cyclic object.

### Expected behavior

`snapshot()` preserves aliasing and cycle topology: a root self-reference remains a self-reference to the returned root.

```text
PASS - bug is fixed
PASS  copy.value
  expected: 2
  actual:   2
PASS  copy.self.value
  expected: 2
  actual:   2
PASS  copy.self === copy
  expected: true (the root self-reference points back at the returned root)
  actual:   true
PASS  copy.self.self === copy.self
  expected: true
  actual:   true
```

### Screenshots or Videos

_No response_

### Platform

- OS: macOS
- Browser: Chrome
- Version: 2.0.0-beta.17 (re-verified at `next` @ `a51cac19`)

### Additional context

Root cause: `packages/solid-signals/src/store/utils.ts:43-59` initially records the store proxy in the cycle map, then replaces `item` with `target[STORE_VALUE]`. It does not map that raw source object to the same result.

When recursion reaches `source.self === source`, the raw object is not found under the proxy key, so `snapshotImpl()` allocates a second clone and maps the cycle to that clone.

Suggested fix direction: whenever a store proxy is unwrapped, map both the proxy and its raw `STORE_VALUE` to the same snapshot result before descending into children. Preserve existing behavior for shared non-cyclic references as well.

## Does this exist in Solid 1.x?

**Regression from 1.x.** Solid 1.9.14 `unwrap()` preserves `copy.self === copy`. The explicit cycle map in the 2.0 implementation also shows that cycle/alias preservation is intended.
