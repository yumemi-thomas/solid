# 2.0.0-beta.17: `createProjection(..., { key: "" })` ignores the requested key and reconciles by `id`

### Describe the bug

An empty string is a valid JavaScript property key and is accepted by `ProjectionOptions.key`, but Solid treats it as missing and silently substitutes the default `"id"` key.

Keyed projections exist precisely so that row proxies keep their identity across reorders. With `{ key: "" }`, rows visibly update after a reorder — the rendered values are correct — but their stable proxy identities do not follow the logical rows: identity is reused positionally instead of following the key. Because the values look right, the error is easy to miss until keyed components lose local DOM or focus state.

### Your Example Website or App

_StackBlitz link to be added — paste the code below into `src/App.tsx` of the standard SolidJS Vite template (`solid-js@2.0.0-beta.17`, `@solidjs/web@2.0.0-beta.17`, `jsxImportSource: "@solidjs/web"`)._

The repro projects rows keyed by the `""` property (return-value projection form: the callback returns the next array and Solid reconciles it into the projection store by `key`), captures the two row proxies, reorders the source rows, and checks whether identity followed the key. It shows a green **PASS — bug is fixed** or red **FAIL — bug reproduced** banner with per-row expected vs actual identity.

```tsx
import { createProjection, createSignal, flush, Show } from "solid-js";

type Row = { "": string; value: number };
type Verdict = { ok: boolean; actual: string };

export default function App() {
  const [rows, setRows] = createSignal<Row[]>([
    { "": "a", value: 1 },
    { "": "b", value: 2 }
  ]);

  // Return-value projection form: the callback returns the next array and Solid
  // reconciles it into the projection store by the `key` property (here `""`),
  // so row proxies keep their identity across reorders.
  const projected = createProjection<Row[]>(() => rows(), [], { key: "" });

  const [verdict, setVerdict] = createSignal<Verdict>();

  function reorderRows() {
    flush();
    const previousA = projected[0]; // proxy for the row whose "" key is "a"
    const previousB = projected[1]; // proxy for the row whose "" key is "b"

    setRows([
      { "": "b", value: 20 },
      { "": "a", value: 10 }
    ]);
    flush();

    const identity = (row: Row) =>
      row === previousA
        ? 'the old row-"a" proxy (reused positionally — key "" was ignored)'
        : row === previousB
          ? 'the old row-"b" proxy'
          : "a fresh proxy";

    setVerdict({
      // identity should follow key "": projected[0] is now the row keyed "b"
      ok: projected[0] === previousB && projected[1] === previousA,
      actual: [
        `projected[0] (now the row keyed "b", value 20): ${identity(projected[0])} — expected the old row-"b" proxy`,
        `projected[1] (now the row keyed "a", value 10): ${identity(projected[1])} — expected the old row-"a" proxy`
      ].join("\n")
    });
  }

  return (
    <main style={{ "font-family": "system-ui", padding: "16px" }}>
      <h2>Empty-string projection key</h2>
      <p>rows: {JSON.stringify(rows())}</p>
      <button onClick={reorderRows}>reorder rows</button>
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

1. Click **reorder rows**. The handler captures the two projected row proxies, then swaps the source rows (also updating their values to `20`/`10`), so each proxy's identity should follow its `""` key to the new position.
2. On 2.0.0-beta.17 the page shows:

```text
FAIL - bug reproduced
projected[0] (now the row keyed "b", value 20): the old row-"a" proxy (reused positionally — key "" was ignored) — expected the old row-"b" proxy
projected[1] (now the row keyed "a", value 10): the old row-"b" proxy — expected the old row-"a" proxy
```

The rendered values are `20` and `10` as expected, which is what makes the identity mismatch easy to miss.

### Expected behavior

Every string accepted by the public key option, including `""`, is used as the identity property, so proxy identity follows the key across the reorder:

```text
PASS - bug is fixed
projected[0] (now the row keyed "b", value 20): the old row-"b" proxy — expected the old row-"b" proxy
projected[1] (now the row keyed "a", value 10): the old row-"a" proxy — expected the old row-"a" proxy
```

### Screenshots or Videos

_No response_

### Platform

- OS: macOS
- Browser: Chrome
- Version: 2.0.0-beta.17 (re-verified at `next` @ `a51cac19`)

### Additional context

Root cause: `packages/solid-signals/src/store/projection.ts:54` defaults with `||`:

```ts
runProjectionComputed(wrappedStore, fn, options?.key || "id");
```

The derived optimistic-store path uses the same pattern.

Suggested fix direction: use a nullish default:

```ts
options?.key ?? "id"
```

Add coverage for `createProjection`, function-form `createStore`, and function-form `createOptimisticStore`.

## Does this exist in Solid 1.x?

**Not applicable — new 2.0 API.** Projection stores and `ProjectionOptions` are new in 2.0.
