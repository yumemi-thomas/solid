# 2.0.0-beta.17: returning an array from a store setter fills holes and ignores named/symbol properties

### Describe the bug

Replacing an array store wholesale by returning a new array from the setter (`setList(() => next)`) — the documented array replacement form — copies numeric positions from `0` to `length - 1` and then assigns `length`. It does not preserve the returned array's actual own-property shape.

This has two manifestations:

1. **Sparse holes become real properties containing `undefined`** — `0 in list` flips to `true` and `Object.keys(list)` grows, so membership, enumeration, and serialization all change.
2. **Named and symbol properties are ignored** — new metadata is not added, changed metadata remains stale, and removed metadata is not deleted.

Both bite the common "replace the list with the server payload" pattern: a sparse payload gets densified, and any metadata the app hangs off the array (labels, cursors, selection markers) silently keeps its pre-replacement values.

### Your Example Website or App

_StackBlitz link to be added — paste the code below into `src/App.tsx` of the standard SolidJS Vite template (`solid-js@2.0.0-beta.17`, `@solidjs/web@2.0.0-beta.17`, `jsxImportSource: "@solidjs/web"`)._

The repro replaces two array stores from a button click — one with a sparse array, one with an array carrying new named/symbol metadata — and shows a single PASS/FAIL banner listing expected vs actual per case.

```tsx
import { createSignal, createStore, flush, Show } from "solid-js";

type CaseResult = { label: string; ok: boolean; expected: string; actual: string };
type Verdict = { ok: boolean; report: string };

const show = (v: unknown) => (typeof v === "string" ? JSON.stringify(v) : String(v));

export default function App() {
  // Manifestation 1: replaced by a sparse array (holes should stay holes).
  const [list, setList] = createStore<number[]>([1, 2]);

  // Manifestation 2: an array carrying named and symbol metadata.
  const meta = Symbol("meta");
  const [tagged, setTagged] = createStore<any>(
    Object.assign([1], { label: "old", [meta]: "old-symbol" })
  );

  const [verdict, setVerdict] = createSignal<Verdict>();

  function replaceFromPayload() {
    // Sparse replacement: [ <hole>, 2 ]
    const next = new Array<number>(2);
    next[1] = 2;
    setList(() => next);
    flush();

    // Metadata replacement: changed label, added key, changed symbol value.
    const next2: any = Object.assign([2], {
      label: "new",
      extra: "added",
      [meta]: "new-symbol"
    });
    setTagged(() => next2);
    flush();

    const cases: CaseResult[] = [
      {
        label: "0 in list",
        ok: !(0 in list),
        expected: "false (hole preserved)",
        actual: String(0 in list)
      },
      {
        label: "Object.keys(list)",
        ok: JSON.stringify(Object.keys(list)) === '["1"]',
        expected: '["1"]',
        actual: JSON.stringify(Object.keys(list))
      },
      {
        label: "tagged.label",
        ok: tagged.label === "new",
        expected: '"new"',
        actual: show(tagged.label)
      },
      {
        label: "tagged.extra",
        ok: tagged.extra === "added",
        expected: '"added"',
        actual: show(tagged.extra)
      },
      {
        label: "tagged[meta]",
        ok: tagged[meta] === "new-symbol",
        expected: '"new-symbol"',
        actual: show(tagged[meta])
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
      <h2>Returned-array replacement shape</h2>
      <p>
        items: {JSON.stringify([...list])} · label: {String(tagged.label)}
      </p>
      <button onClick={replaceFromPayload}>replace lists from payload</button>
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

1. Click **replace lists from payload**. The first store is replaced by a sparse two-slot array (`[ <hole>, 2 ]`), the second by an array whose `label`/`extra`/symbol metadata differs from the current store's.
2. On 2.0.0-beta.17 the page shows:

```text
FAIL - bug reproduced
FAIL  0 in list
  expected: false (hole preserved)
  actual:   true
FAIL  Object.keys(list)
  expected: ["1"]
  actual:   ["0","1"]
FAIL  tagged.label
  expected: "new"
  actual:   "old"
FAIL  tagged.extra
  expected: "added"
  actual:   undefined
FAIL  tagged[meta]
  expected: "new-symbol"
  actual:   "old-symbol"
```

### Expected behavior

Returning an array as a replacement should shallow-diff its enumerable own properties, including sparse membership, named properties, and enumerable symbols. The result should match the returned array's observable property shape:

```text
PASS - bug is fixed
PASS  0 in list
  expected: false (hole preserved)
  actual:   false
PASS  Object.keys(list)
  expected: ["1"]
  actual:   ["1"]
PASS  tagged.label
  expected: "new"
  actual:   "new"
PASS  tagged.extra
  expected: "added"
  actual:   "added"
PASS  tagged[meta]
  expected: "new-symbol"
  actual:   "new-symbol"
```

### Screenshots or Videos

_No response_

### Platform

- OS: macOS
- Browser: Chrome
- Version: 2.0.0-beta.17 (re-verified at `next` @ `a51cac19`)

### Additional context

Root cause: `packages/solid-signals/src/store/store.ts:825-835` special-cases arrays:

```ts
for (let i = 0; i < value.length; i++) store[i] = value[i];
store.length = value.length;
```

Reading a hole yields `undefined`; assigning that value creates a property. No non-index keys are enumerated or removed.

Suggested fix direction: diff enumerable own keys and membership instead of iterating all positions. Handle `length` after index deletions/additions, while preserving array-specific ordering and batching.

## Does this exist in Solid 1.x?

**Mixed.** Solid 1.9.14 preserves sparse holes for the equivalent root array replacement — hole densification (manifestation 1) is a **regression**. Ignoring named/symbol array metadata (manifestation 2) is **long-standing** — it also reproduces in 1.9.14.
