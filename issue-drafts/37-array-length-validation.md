# 2.0.0-beta.17 regression: store array `length` accepts invalid values and skips JavaScript coercion

### Describe the bug

Assigning `length` through a store draft does not implement normal array semantics. Negative and fractional lengths are accepted instead of throwing, and a numeric string remains a string instead of being coerced to a number:

| Write | Solid 2.0.0-beta.17 | Native array / Solid 1.9.14 |
|---|---|---|
| `length = -1` | stores `-1` | throws `RangeError` |
| `length = 1.5` | stores `1.5` | throws `RangeError` |
| `length = "2"` | stores string `"2"` | stores number `2` |

Truncating a list with a `length` write is an ordinary array idiom, and the failure mode here is the bad kind: nothing throws at the write. The corrupted negative/fractional length sits silently in the store, and the first thing to blow up is whatever code later takes a copy — `snapshot(list)` throws `RangeError: Invalid array length` far away from the write that caused it.

### Your Example Website or App

_StackBlitz link to be added — paste the code below into `src/App.tsx` of the standard SolidJS Vite template (`solid-js@2.0.0-beta.17`, `@solidjs/web@2.0.0-beta.17`, `jsxImportSource: "@solidjs/web"`)._

The repro runs four labeled cases (each on a fresh three-item list store): the three `length` writes from the matrix above, plus the `snapshot()` follow-on failure after the accepted `-1`. One click shows a single PASS/FAIL banner with expected vs actual per case.

```tsx
import { createSignal, createStore, flush, Show, snapshot } from "solid-js";

type CaseResult = { label: string; ok: boolean; expected: string; actual: string };
type Verdict = { ok: boolean; report: string };

export default function App() {
  const [verdict, setVerdict] = createSignal<Verdict>();

  function runLengthWrites() {
    const cases: CaseResult[] = [];

    // Cases 1 and 2: invalid lengths -1 and 1.5 — native arrays (and
    // Solid 1.9.14) throw RangeError and leave the array untouched.
    for (const bad of [-1, 1.5]) {
      const [list, setList] = createStore(["milk", "eggs", "bread"]);
      let threw: string | null = null;
      try {
        setList(draft => {
          (draft as any).length = bad;
        });
        flush();
      } catch (e) {
        threw = e instanceof RangeError ? "RangeError" : String(e);
      }
      cases.push({
        label: `list.length = ${bad}`,
        ok: threw === "RangeError",
        expected: "throws RangeError (native ArraySetLength semantics)",
        actual: threw ?? `accepted — list.length is now ${list.length}`
      });
    }

    // Case 3: numeric string "2" — native arrays coerce it to the number 2.
    {
      const [list, setList] = createStore(["milk", "eggs", "bread"]);
      setList(draft => {
        (draft as any).length = "2";
      });
      flush();
      cases.push({
        label: 'list.length = "2"',
        ok: (list.length as any) === 2,
        expected: "number 2 (coerced)",
        actual: `${typeof list.length} ${JSON.stringify(list.length)}`
      });
    }

    // Case 4 (follow-on): after the invalid `-1` write is accepted,
    // snapshot(list) throws RangeError far away from the bad write.
    {
      const [list, setList] = createStore(["milk", "eggs", "bread"]);
      try {
        setList(draft => {
          (draft as any).length = -1;
        });
        flush();
      } catch {
        // if the write correctly throws, snapshot below sees a valid array
      }
      let snapThrew: string | null = null;
      try {
        snapshot(list);
      } catch (e) {
        snapThrew = String(e);
      }
      cases.push({
        label: "snapshot(list) after length = -1",
        ok: snapThrew === null,
        expected: "does not throw (the invalid length was rejected at the write)",
        actual: snapThrew ? `throws ${snapThrew}` : "did not throw"
      });
    }

    setVerdict({
      ok: cases.every(c => c.ok),
      report: cases
        .map(c => `${c.ok ? "PASS" : "FAIL"}  ${c.label}\n  expected: ${c.expected}\n  actual:   ${c.actual}`)
        .join("\n")
    });
  }

  return (
    <main style={{ "font-family": "system-ui", padding: "16px" }}>
      <h2>Store array length: validation and coercion</h2>
      <button onClick={runLengthWrites}>run length writes</button>
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

1. Click **run length writes**. Each case creates a fresh three-item list store and performs one `length` write through the draft; the last case takes a `snapshot()` after the accepted `-1` write.
2. On 2.0.0-beta.17 the page shows:

```text
FAIL - bug reproduced
FAIL  list.length = -1
  expected: throws RangeError (native ArraySetLength semantics)
  actual:   accepted — list.length is now -1
FAIL  list.length = 1.5
  expected: throws RangeError (native ArraySetLength semantics)
  actual:   accepted — list.length is now 1.5
FAIL  list.length = "2"
  expected: number 2 (coerced)
  actual:   string "2"
FAIL  snapshot(list) after length = -1
  expected: does not throw (the invalid length was rejected at the write)
  actual:   throws RangeError: Invalid array length
```

### Expected behavior

Match JavaScript's ArraySetLength semantics: coerce valid values to an unsigned 32-bit length and throw `RangeError` when the numeric value is not exactly representable as a valid array length.

```text
PASS - bug is fixed
PASS  list.length = -1
  expected: throws RangeError (native ArraySetLength semantics)
  actual:   RangeError
PASS  list.length = 1.5
  expected: throws RangeError (native ArraySetLength semantics)
  actual:   RangeError
PASS  list.length = "2"
  expected: number 2 (coerced)
  actual:   number 2
PASS  snapshot(list) after length = -1
  expected: does not throw (the invalid length was rejected at the write)
  actual:   did not throw
```

### Screenshots or Videos

_No response_

### Platform

- OS: macOS
- Browser: Chrome
- Version: 2.0.0-beta.17 (re-verified at `next` @ `a51cac19`)

### Additional context

Root cause: the set trap in `packages/solid-signals/src/store/store.ts:633-663` stores the raw unwrapped value in a plain override record. It never invokes or emulates the native array `length` setter, so no ToUint32 coercion or validity check ever runs.

Suggested fix direction: normalize and validate `length` before modifying overrides or notifying nodes. The operation should be atomic: invalid values must not leave any pending override or notification behind.

## Does this exist in Solid 1.x?

**Regression from 1.x.** Solid 1.9.14 throws `RangeError` for `-1`/`1.5` and coerces `"2"` to numeric `2`, matching native arrays.
