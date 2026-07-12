# 2.0.0-beta.17: `snapshot()` / store-to-store writes drop symbol-keyed properties once the object has been written

### Describe the bug

After any write to a store subtree, `snapshot()` of it and copying it into another store both drop symbol-keyed properties. Before the first write they're preserved (identity return path), so the loss appears only once the object has an override.

Symbol keys are the standard way a data layer attaches metadata that cannot collide with API fields (cache etags, dirty flags). Dropping them breaks save/undo flows that snapshot edited store state before sending it to a worker, cache, or another store — and because the failure only appears after a normal field edit, initial tests with untouched records pass. `unwrap` enumerates through the same path (`getKeys`), so `unwrap(state)[sym]` goes `undefined` the same way, as does writing a previously-written subtree into another store.

### Your Example Website or App

_StackBlitz link to be added — paste the code below into `src/App.tsx` of the standard SolidJS Vite template (`solid-js@2.0.0-beta.17`, `@solidjs/web@2.0.0-beta.17`, `jsxImportSource: "@solidjs/web"`)._

The repro keeps an invoice record with a symbol-keyed cache tag in a store. Clicking the button snapshots it before and after a normal field edit and compares: the pre-write snapshot keeps the symbol (control), the post-write snapshot must too.

```tsx
import { createSignal, createStore, flush, Show, snapshot } from "solid-js";

const cacheMeta = Symbol("cacheMeta");

type Verdict = { ok: boolean; actual: string };

export default function App() {
  const [invoice, setInvoice] = createStore({ total: 100, [cacheMeta]: "etag-v1" } as any);
  const [verdict, setVerdict] = createSignal<Verdict>();

  function editAndSnapshot() {
    // control: before any write, snapshot() returns the original object and
    // the symbol survives (identity return path).
    const before = snapshot(invoice) as any;

    setInvoice((draft: any) => {
      draft.total = 125;
    });
    flush();

    const after = snapshot(invoice) as any;
    setVerdict({
      ok: after[cacheMeta] === "etag-v1",
      actual: [
        `before write: total=${before.total}, [cacheMeta]=${String(before[cacheMeta])}`,
        `after write:  total=${after.total}, [cacheMeta]=${String(after[cacheMeta])}`
      ].join("\n")
    });
  }

  return (
    <main style={{ "font-family": "system-ui", padding: "16px" }}>
      <h2>snapshot() drops symbol keys after a write</h2>
      <p>total: {invoice.total}</p>
      <button onClick={editAndSnapshot}>edit total and snapshot</button>
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

1. Click **edit total and snapshot**. The handler snapshots the record, writes `total = 125` through the setter, flushes, and snapshots again.
2. The pre-write snapshot keeps the symbol-keyed property; the post-write snapshot silently drops it while keeping the edited field.

On 2.0.0-beta.17 the page shows:

```text
FAIL - bug reproduced
before write: total=100, [cacheMeta]=etag-v1
after write:  total=125, [cacheMeta]=undefined
```

### Expected behavior

Symbol keys survive `snapshot`/`unwrap` after writes, as in Solid 1.x (verified 1.9.14: `unwrap(state)[sym] === "keep"`):

```text
PASS - bug is fixed
before write: total=100, [cacheMeta]=etag-v1
after write:  total=125, [cacheMeta]=etag-v1
```

### Screenshots or Videos

_No response_

### Platform

- OS: macOS
- Browser: Chrome
- Version: 2.0.0-beta.17 (re-verified at `next` @ `a51cac19`)

### Additional context

Root cause: `getKeys()` (`packages/solid-signals/src/store/store.ts:284-298`) seeds base keys from `Object.keys(source)` (strings only), and drives both `snapshotImpl` (`utils.ts:60`) and `unwrapStoreValue` (`store.ts:178`). Residual gap of #2769, which added `ownEnumerableKeys` only to the setter/merge/omit/set-trap sites — not the snapshot/unwrap enumeration.

Because `unwrapStoreValue` shares the same enumeration, writing a written store subtree into another store also drops its symbol-keyed props (third case in the repro test).

Repro test: `packages/solid-signals/tests/store/hunt2-snapshot-symbol-keys.test.ts` (2 failing + control). 1.x check: `hunt-1x-checks/checks/w2-store-unwrap-symbol-keys.test.ts`.

## Does this exist in Solid 1.x?

**Regression.** Verified against 1.9.14: `unwrap` after a write keeps symbol keys, and copying a written subtree into another store keeps them.
