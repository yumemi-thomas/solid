# 2.0.0-beta.17: `Object.defineProperty()` on a projection draft returns success but silently drops the property

### Describe the bug

Projection callbacks receive a documented mutable draft, but descriptor writes do not work: `Reflect.defineProperty()` returns `true` while the property remains absent both inside the compute and on the projection outside it. Descriptor-driven code — `Object.defineProperties`-based copy/merge helpers, utilities attaching metadata via descriptors — silently no-ops on a projection draft while reporting success.

Plain `createStore` setters support `Object.defineProperty`, making the two draft APIs internally inconsistent.

### Your Example Website or App

_StackBlitz link to be added — paste the code below into `src/App.tsx` of the standard SolidJS Vite template (`solid-js@2.0.0-beta.17`, `@solidjs/web@2.0.0-beta.17`, `jsxImportSource: "@solidjs/web"`)._

The repro calls `Reflect.defineProperty(draft, "added", { value: 2, ... })` inside a projection compute, recording the reported result and the draft read-back into variables that are asserted after `flush()` (an assertion that throws inside the projection compute can be swallowed). It shows a green **PASS — bug is fixed** or red **FAIL — bug reproduced** banner with per-check expected vs actual.

```tsx
import { createProjection, createSignal, flush, Show } from "solid-js";

type Verdict = { ok: boolean; actual: string };

export default function App() {
  // The defineProperty result and the draft read are recorded into these
  // variables inside the compute callback and asserted after flush().
  let reportedSuccess: boolean | undefined;
  let draftAdded: number | undefined;

  const projected = createProjection((draft: { added?: number }) => {
    reportedSuccess = Reflect.defineProperty(draft, "added", {
      value: 2,
      enumerable: true,
      configurable: true,
      writable: true
    });
    draftAdded = draft.added;
  }, {} as { added?: number });

  const [verdict, setVerdict] = createSignal<Verdict>();

  function defineOnDraft() {
    void projected.added; // projections are lazy — read once so the compute runs
    flush();

    const has = "added" in projected;
    setVerdict({
      ok: reportedSuccess === true && draftAdded === 2 && has && projected.added === 2,
      actual: [
        `Reflect.defineProperty(draft, "added", ...) returned: ${reportedSuccess} (expected true)`,
        `draft.added read inside the compute: ${draftAdded} (expected 2)`,
        `"added" in projected: ${has} (expected true)`,
        `projected.added: ${projected.added} (expected 2)`
      ].join("\n")
    });
  }

  return (
    <main style={{ "font-family": "system-ui", padding: "16px" }}>
      <h2>defineProperty on a projection draft</h2>
      <button onClick={defineOnDraft}>defineProperty on the projection draft</button>
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

1. Click **defineProperty on the projection draft**. The handler reads the projection once (projections are lazy, so this runs the compute, which calls `Reflect.defineProperty(draft, "added", { value: 2, ... })` and reads the property back from the draft), then checks the property on the projection from outside.
2. On 2.0.0-beta.17 the page shows:

```text
FAIL - bug reproduced
Reflect.defineProperty(draft, "added", ...) returned: true (expected true)
draft.added read inside the compute: undefined (expected 2)
"added" in projected: false (expected true)
projected.added: undefined (expected 2)
```

Success is reported, but the write was dropped — the property never exists, inside or outside the projection.

### Expected behavior

Either apply the descriptor like a plain store draft, or reject the operation. Reporting success while dropping the write is unsafe. With the descriptor applied:

```text
PASS - bug is fixed
Reflect.defineProperty(draft, "added", ...) returned: true (expected true)
draft.added read inside the compute: 2 (expected 2)
"added" in projected: true (expected true)
projected.added: 2 (expected 2)
```

### Screenshots or Videos

_No response_

### Platform

- OS: macOS
- Browser: Chrome
- Version: 2.0.0-beta.17 (re-verified at `next` @ `a51cac19`)

### Additional context

Root cause: the projection proxy handler in `packages/solid-signals/src/store/projection.ts:157-213` implements `get`, `has`, `set`, and `deleteProperty`, but not `defineProperty`.

The operation forwards to the underlying store proxy without enabling the projection write override. The underlying trap returns `true`, but skips the write because it does not recognize an active write scope.

The missing trap also bypasses the async projection's stale-write guard and `onDraftWrite` hook.

Suggested fix direction: implement `defineProperty` with the same active guard and projection/write override scope as `set` and `deleteProperty`. Normalize descriptor values consistently with the plain store trap.

## Does this exist in Solid 1.x?

**Not applicable — new 2.0 API.** `createProjection` is new in 2.0. The expected behavior is already covered for plain 2.0 store setters by the official `Object.defineProperty` tests.
