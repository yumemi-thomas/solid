# 2.0.0-beta.17: `reconcile()` leaves tracked named/symbol array properties stale while enumeration shows the new shape

### Describe the bug

Array reconciliation swaps the raw backing array and updates numeric positions/length, but does not update tracked named or symbol property nodes. It also does not invalidate structural tracking (`$TRACK`) when only array metadata changes.

The same proxy can therefore expose old values through property reads and new values through key enumeration — a split-brain that persists indefinitely:

1. A memo over `list.label` keeps returning the pre-reconcile value.
2. A **direct** `list.label` read is poisoned too — the stale property node caches the old value.
3. A memo over `Object.keys(list)` never re-runs, so it misses the added key.
4. Meanwhile a direct `Object.keys(list)` call shows the new shape, and a key that had no pre-existing node (`list.extra`) reads correctly.

Tracked symbol metadata has the same class of failure. Any app that reconciles server payloads into an array store carrying metadata (labels, cursors, totals) gets a proxy that permanently disagrees with itself about that metadata.

### Your Example Website or App

_StackBlitz link to be added — paste the code below into `src/App.tsx` of the standard SolidJS Vite template (`solid-js@2.0.0-beta.17`, `@solidjs/web@2.0.0-beta.17`, `jsxImportSource: "@solidjs/web"`)._

The repro renders two memos (over `list.label` and `Object.keys(list)`) next to the direct proxy reads, reconciles a new payload on click, and shows a single PASS/FAIL banner listing expected vs actual per observation path — the mixed PASS/FAIL rows are the split-brain.

```tsx
import { createMemo, createSignal, createStore, flush, reconcile, Show } from "solid-js";

type CaseResult = { label: string; ok: boolean; expected: string; actual: string };
type Verdict = { ok: boolean; report: string };

const show = (v: unknown) => (typeof v === "string" ? JSON.stringify(v) : String(v));

export default function App() {
  const [list, setList] = createStore<any>(Object.assign([1], { label: "old" }));

  // Tracked observers (memos) alongside direct proxy reads: the bug is that
  // different observation paths disagree after reconciliation. Rendering them
  // below primes both memos on the pre-reconcile values.
  const label = createMemo(() => list.label);
  const keys = createMemo(() => Object.keys(list).join(","));

  const [verdict, setVerdict] = createSignal<Verdict>();

  function syncFromServer() {
    const next: any = Object.assign([1], { label: "new", extra: "added" });
    // reconcile() requires a key argument; these rows are primitive numbers
    // with no `id` property, so the key never matches and reconciliation is
    // positional.
    setList(reconcile(next, "id"));
    flush();

    const cases: CaseResult[] = [
      // The split-brain pair: memo read vs direct read of the same property.
      {
        label: "label() — memo over list.label",
        ok: label() === "new",
        expected: '"new"',
        actual: show(label())
      },
      {
        label: "list.label — direct proxy read",
        ok: list.label === "new",
        expected: '"new"',
        actual: show(list.label)
      },
      {
        label: "keys() — memo over Object.keys(list)",
        ok: keys() === "0,label,extra",
        expected: '"0,label,extra"',
        actual: show(keys())
      },
      {
        label: "Object.keys(list) — direct enumeration",
        ok: Object.keys(list).join(",") === "0,label,extra",
        expected: '"0,label,extra"',
        actual: show(Object.keys(list).join(","))
      },
      {
        label: "list.extra — direct proxy read (no stale node existed)",
        ok: list.extra === "added",
        expected: '"added"',
        actual: show(list.extra)
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
      <h2>reconcile() vs array metadata</h2>
      <p>
        memo label: {String(label())} · memo keys: {keys()}
      </p>
      <button onClick={syncFromServer}>sync from server</button>
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

1. The page renders the two memos on the initial store (`memo label: old · memo keys: 0,label`).
2. Click **sync from server**. It reconciles a payload whose `label` changed to `"new"` and which gained an `extra` key, then reads the same data through four paths: the two memos, a direct property read, and direct enumeration.
3. On 2.0.0-beta.17 the page shows the paths disagreeing (the rendered memo line also stays `old`):

```text
FAIL - bug reproduced
FAIL  label() — memo over list.label
  expected: "new"
  actual:   "old"
FAIL  list.label — direct proxy read
  expected: "new"
  actual:   "old"
FAIL  keys() — memo over Object.keys(list)
  expected: "0,label,extra"
  actual:   "0,label"
PASS  Object.keys(list) — direct enumeration
  expected: "0,label,extra"
  actual:   "0,label,extra"
PASS  list.extra — direct proxy read (no stale node existed)
  expected: "added"
  actual:   "added"
```

### Expected behavior

All observation paths agree after reconciliation: existing property nodes receive new metadata values, removed metadata becomes absent, new tracked values update, and metadata-only shape changes notify `$TRACK`.

```text
PASS - bug is fixed
PASS  label() — memo over list.label
  expected: "new"
  actual:   "new"
PASS  list.label — direct proxy read
  expected: "new"
  actual:   "new"
PASS  keys() — memo over Object.keys(list)
  expected: "0,label,extra"
  actual:   "0,label,extra"
PASS  Object.keys(list) — direct enumeration
  expected: "0,label,extra"
  actual:   "0,label,extra"
PASS  list.extra — direct proxy read (no stale node existed)
  expected: "added"
  actual:   "added"
```

### Screenshots or Videos

_No response_

### Platform

- OS: macOS
- Browser: Chrome
- Version: 2.0.0-beta.17 (re-verified at `next` @ `a51cac19`)

### Additional context

Root cause: the array branches in `packages/solid-signals/src/store/reconcile.ts:168-270` and `:307-423` only reconcile integer slots and length. `syncArrayNodeMembership()` updates a property value node only when the key disappears; it does not update the value of a named key that remains present.

The `changed` flag ignores metadata-only changes, so the structural `$TRACK` node is not notified.

Suggested fix direction: after numeric reconciliation, diff enumerable non-index string/symbol keys and update their value, presence, and structural nodes. Avoid treating `length` or internal symbols as user metadata.

Related: `reconcile()` has the same "updates the raw value but never notifies" gap for keyless built-in leaves (`Date`/`Map`/`Set`/`RegExp`) — filed separately.

## Does this exist in Solid 1.x?

**Long-standing — but worse in 2.0.** Solid 1.9.14 also fails to invalidate the memo, but a direct `list.label` read returns `"new"`. Solid 2.0 is worse because the stale node cache also poisons later direct reads.
