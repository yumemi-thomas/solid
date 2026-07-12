# 2.0.0-beta.17: `snapshot()` / `deep()` fill sparse array holes and drop array metadata after any write

### Describe the bug

Once an array store has an override (i.e. after any write), `snapshot()` and `deep()` build a new array by walking every integer from zero to `length - 1`. Missing positions are assigned `undefined`, turning holes into real properties. Named and symbol properties are not copied at all.

This changes membership (`0 in copy`), enumeration (`Object.keys`), serialization behavior, and loses user metadata — any consumer that serializes, diffs, or structured-clones the copy sees a different shape than the store holds. `deep()` shares the same implementation and should differ from `snapshot()` only by tracking behavior, but it produces the same wrong dense array.

### Your Example Website or App

_StackBlitz link to be added — paste the code below into `src/App.tsx` of the standard SolidJS Vite template (`solid-js@2.0.0-beta.17`, `@solidjs/web@2.0.0-beta.17`, `jsxImportSource: "@solidjs/web"`)._

The repro writes one index in each of two array stores — a sparse one and one carrying named/symbol metadata — then copies them with `snapshot()` and `deep()`, and shows a single PASS/FAIL banner listing expected vs actual per case.

```tsx
import { createSignal, createStore, deep, flush, Show, snapshot } from "solid-js";

type CaseResult = { label: string; ok: boolean; expected: string; actual: string };
type Verdict = { ok: boolean; report: string };

const show = (v: unknown) => (typeof v === "string" ? JSON.stringify(v) : String(v));

export default function App() {
  // Manifestation 1: a sparse array (three slots, only the last present).
  const source = new Array<number>(3); // [ <hole>, <hole>, <hole> ]
  source[2] = 3;
  const [list, setList] = createStore(source);

  // Manifestation 2: an array carrying named and symbol metadata.
  const meta = Symbol("meta");
  const [tagged, setTagged] = createStore<any>(
    Object.assign([1], { label: "keep", [meta]: "keep-symbol" })
  );

  const [verdict, setVerdict] = createSignal<Verdict>();

  function writeAndCopy() {
    // Any write creates an override; the copies go wrong from then on.
    setList(draft => {
      draft[2] = 4;
    });
    flush();

    const copy = snapshot(list);
    // deep() shares the same implementation and should differ from snapshot()
    // only by tracking behavior; called here untracked, it also works — and
    // produces the same (wrong) dense array.
    const deepCopy = deep(list);

    setTagged(draft => {
      draft[0] = 2; // unrelated index write
    });
    flush();

    const copy2: any = snapshot(tagged);

    const cases: CaseResult[] = [
      {
        label: "0 in snapshot(list)",
        ok: !(0 in copy),
        expected: "false (hole preserved)",
        actual: String(0 in copy)
      },
      {
        label: "1 in snapshot(list)",
        ok: !(1 in copy),
        expected: "false (hole preserved)",
        actual: String(1 in copy)
      },
      {
        label: "Object.keys(snapshot(list))",
        ok: JSON.stringify(Object.keys(copy)) === '["2"]',
        expected: '["2"]',
        actual: JSON.stringify(Object.keys(copy))
      },
      {
        label: "0 in deep(list)",
        ok: !(0 in deepCopy),
        expected: "false (hole preserved)",
        actual: String(0 in deepCopy)
      },
      {
        label: "Object.keys(deep(list))",
        ok: JSON.stringify(Object.keys(deepCopy)) === '["2"]',
        expected: '["2"]',
        actual: JSON.stringify(Object.keys(deepCopy))
      },
      {
        label: "snapshot(tagged).label",
        ok: copy2.label === "keep",
        expected: '"keep"',
        actual: show(copy2.label)
      },
      {
        label: "snapshot(tagged)[meta]",
        ok: copy2[meta] === "keep-symbol",
        expected: '"keep-symbol"',
        actual: show(copy2[meta])
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
      <h2>snapshot()/deep() vs sparse holes and array metadata</h2>
      <p>
        items: {JSON.stringify([...list])} (length: {list.length}) · label: {String(tagged.label)}
      </p>
      <button onClick={writeAndCopy}>write one index and copy</button>
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

1. Click **write one index and copy**. Each store receives a single index write (`draft[2] = 4` on the sparse list, `draft[0] = 2` on the tagged list), then is copied via `snapshot()` (and `deep()` for the sparse one).
2. On 2.0.0-beta.17 the page shows every copy disagreeing with the store's shape:

```text
FAIL - bug reproduced
FAIL  0 in snapshot(list)
  expected: false (hole preserved)
  actual:   true
FAIL  1 in snapshot(list)
  expected: false (hole preserved)
  actual:   true
FAIL  Object.keys(snapshot(list))
  expected: ["2"]
  actual:   ["0","1","2"]
FAIL  0 in deep(list)
  expected: false (hole preserved)
  actual:   true
FAIL  Object.keys(deep(list))
  expected: ["2"]
  actual:   ["0","1","2"]
FAIL  snapshot(tagged).label
  expected: "keep"
  actual:   undefined
FAIL  snapshot(tagged)[meta]
  expected: "keep-symbol"
  actual:   undefined
```

### Expected behavior

Snapshots preserve array property membership and enumerable metadata while returning plain, non-reactive data; `deep()` differs only by tracking behavior, not by value shape:

```text
PASS - bug is fixed
PASS  0 in snapshot(list)
  expected: false (hole preserved)
  actual:   false
PASS  1 in snapshot(list)
  expected: false (hole preserved)
  actual:   false
PASS  Object.keys(snapshot(list))
  expected: ["2"]
  actual:   ["2"]
PASS  0 in deep(list)
  expected: false (hole preserved)
  actual:   false
PASS  Object.keys(deep(list))
  expected: ["2"]
  actual:   ["2"]
PASS  snapshot(tagged).label
  expected: "keep"
  actual:   "keep"
PASS  snapshot(tagged)[meta]
  expected: "keep-symbol"
  actual:   "keep-symbol"
```

### Screenshots or Videos

_No response_

### Platform

- OS: macOS
- Browser: Chrome
- Version: 2.0.0-beta.17 (re-verified at `next` @ `a51cac19`)

### Additional context

Root cause: `packages/solid-signals/src/store/utils.ts:61-74` starts with `result = []`, iterates by length, and assigns every position whenever `result` exists:

```ts
if (snapshotImpl(v, ...) !== v || result) result[i] = unwrapped;
```

It never checks `i in override || i in item`, and the array branch never enumerates non-index keys.

Suggested fix direction: copy only positions actually present in the effective overlay/base array, explicitly preserve length, then copy enumerable named and symbol properties through the same recursive snapshot logic.

Related: `snapshotImpl` has the same metadata-loss class on plain objects — `snapshot()` drops symbol keys after a write — filed separately; named array metadata and hole densification are separate paths in the array branch.

## Does this exist in Solid 1.x?

**Regression from 1.x** (with a long-standing overlap). Solid 1.9.14 `unwrap()` preserves sparse membership, so hole densification is a regression. Symbol metadata loss overlaps the separately reported object snapshot issue, but named array metadata and hole densification are separate paths.
