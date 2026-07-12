# 2.0.0-beta.17: projection drafts return a fresh nested proxy per read, breaking `includes()` / `indexOf()`

### Describe the bug

Repeatedly reading the same nested object from a `createProjection` draft returns a different proxy identity each time. Standard identity-based operations therefore fail for values obtained from that same draft:

1. `draft[0] === draft[0]` is `false`.
2. `draft.includes(draft[0])` is `false` and `draft.indexOf(draft[0])` is `-1`, even though the element came directly from `draft`.

That breaks the natural "find a row, then act on it" pattern inside a projection compute:

```ts
createProjection(draft => {
  const selected = draft.find(row => row.id === selectedId());
  if (selected && draft.includes(selected)) {
    // Never runs, although `selected` came directly from `draft`.
  }
}, rows);
```

Set/Map membership and WeakMap metadata keyed by draft objects are affected for the same reason.

The boundary of the bug, for contrast: plain `createStore` setter drafts behave correctly — within one setter call `draft[0] === draft[0]` is `true` and `includes()`/`indexOf()` work. The repro runs that control alongside the projection, so the inconsistency between the two draft APIs is visible in one click.

### Your Example Website or App

_StackBlitz link to be added — paste the code below into `src/App.tsx` of the standard SolidJS Vite template (`solid-js@2.0.0-beta.17`, `@solidjs/web@2.0.0-beta.17`, `jsxImportSource: "@solidjs/web"`)._

The repro records the three identity probes inside a projection compute (results are captured into variables and asserted after `flush()`), then runs the same probes in a plain store setter as a control. It shows a green **PASS — bug is fixed** banner if all six checks pass, or a red **FAIL — bug reproduced** banner with the per-check results.

```tsx
import { createProjection, createSignal, createStore, flush, Show } from "solid-js";

type Verdict = { ok: boolean; actual: string };

export default function App() {
  const [verdict, setVerdict] = createSignal<Verdict>();

  // createProjection draft (buggy): results are recorded inside the compute
  // callback and asserted after flush().
  let same: boolean | undefined;
  let includes: boolean | undefined;
  let index: number | undefined;
  const projected = createProjection((draft: { id: number }[]) => {
    same = draft[0] === draft[0];        // expected true
    includes = draft.includes(draft[0]); // expected true
    index = draft.indexOf(draft[0]);     // expected 0
  }, [{ id: 1 }]);

  // plain store draft (control: behaves correctly)
  let sSame: boolean | undefined;
  let sIncludes: boolean | undefined;
  let sIndex: number | undefined;
  const [, setList] = createStore([{ id: 1 }]);

  function runChecks() {
    void projected[0]; // projections are lazy — read once so the compute runs
    flush();

    setList(draft => {
      sSame = draft[0] === draft[0];
      sIncludes = draft.includes(draft[0]);
      sIndex = draft.indexOf(draft[0]);
    });
    flush();

    setVerdict({
      ok:
        same === true &&
        includes === true &&
        index === 0 &&
        sSame === true &&
        sIncludes === true &&
        sIndex === 0,
      actual: [
        `projection: draft[0] === draft[0] -> ${same} (expected true)`,
        `projection: draft.includes(draft[0]) -> ${includes} (expected true)`,
        `projection: draft.indexOf(draft[0]) -> ${index} (expected 0)`,
        `plain store control: draft[0] === draft[0] -> ${sSame} (expected true)`,
        `plain store control: draft.includes(draft[0]) -> ${sIncludes} (expected true)`,
        `plain store control: draft.indexOf(draft[0]) -> ${sIndex} (expected 0)`
      ].join("\n")
    });
  }

  return (
    <main style={{ "font-family": "system-ui", padding: "16px" }}>
      <h2>Projection draft identity</h2>
      <button onClick={runChecks}>run draft identity checks</button>
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

1. Click **run draft identity checks**. The handler reads the projection once (projections are lazy, so this runs the compute, which records `draft[0] === draft[0]`, `draft.includes(draft[0])`, and `draft.indexOf(draft[0])`), then runs the same three probes inside a plain `createStore` setter as a control.
2. On 2.0.0-beta.17 the page shows:

```text
FAIL - bug reproduced
projection: draft[0] === draft[0] -> false (expected true)
projection: draft.includes(draft[0]) -> false (expected true)
projection: draft.indexOf(draft[0]) -> -1 (expected 0)
plain store control: draft[0] === draft[0] -> true (expected true)
plain store control: draft.includes(draft[0]) -> true (expected true)
plain store control: draft.indexOf(draft[0]) -> 0 (expected 0)
```

### Expected behavior

Within one projection run, reading the same store object returns the same draft proxy, so array identity methods behave like normal JavaScript and like plain store setters:

```text
PASS - bug is fixed
projection: draft[0] === draft[0] -> true (expected true)
projection: draft.includes(draft[0]) -> true (expected true)
projection: draft.indexOf(draft[0]) -> 0 (expected 0)
plain store control: draft[0] === draft[0] -> true (expected true)
plain store control: draft.includes(draft[0]) -> true (expected true)
plain store control: draft.indexOf(draft[0]) -> 0 (expected 0)
```

### Screenshots or Videos

_No response_

### Platform

- OS: macOS
- Browser: Chrome
- Version: 2.0.0-beta.17 (re-verified at `next` @ `a51cac19`)

### Additional context

Root cause: `packages/solid-signals/src/store/projection.ts:162-174` creates a new proxy on every object-valued read:

```ts
return typeof value === "object" && value !== null ? new Proxy(value, traps) : value;
```

There is no cache for the write-draft proxy layer.

Suggested fix direction: cache nested draft proxies by underlying wrapped value for the lifetime of a projection run. The cache must also preserve the active/stale-write guard used by async projections.

## Does this exist in Solid 1.x?

**Not applicable — new 2.0 API.** `createProjection` has no Solid 1.x counterpart. Plain 2.0 store setters already demonstrate the expected stable draft identity (the repro's control).
