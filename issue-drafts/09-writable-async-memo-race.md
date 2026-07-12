# 2.0.0-beta.17: writable async memo silently swallows a manual `set()` while a fetch is in flight

### Describe the bug

A writable memo whose computation returns a promise is meant to support optimistic local edits — the `setMemo` JSDoc says "the manual value wins". But a `set()` performed while a fetch is in flight is silently dropped: the manual value never becomes visible (not through the accessor, render effects, or `latest()`), and when the in-flight promise resolves it clobbers the write. Both windows are affected: the initial fetch and an in-flight refetch (a `set()` made *after* the refetch started is later overwritten by the superseded fetch's result).

This defeats exactly the use case writable async memos are supposed to enable. A document editor that loads a draft from the server but lets the user type immediately —

```ts
const [draft, setDraft] = createSignal(() => fetch(`/api/docs/${docId()}`).then(r => r.text()));

textarea.addEventListener("input", event => {
  setDraft((event.currentTarget as HTMLTextAreaElement).value);
});
```

— never shows the user's edit if they type while the initial fetch or a refetch is pending, and the eventual server response overwrites it.

### Your Example Website or App

_StackBlitz link to be added — paste the code below into `src/App.tsx` of the standard SolidJS Vite template (`solid-js@2.0.0-beta.17`, `@solidjs/web@2.0.0-beta.17`, `jsxImportSource: "@solidjs/web"`)._

The repro creates a writable async memo whose initial fetch never resolves and probes what downstream consumers see through a render effect. Clicking the button performs the manual `set()` while the fetch is in flight; a green **PASS** banner means the bug is fixed, a red **FAIL** banner means it reproduced.

```tsx
import { createRenderEffect, createSignal, flush, Show } from "solid-js";

type Verdict = { ok: boolean; actual: string };

export default function App() {
  // The initial fetch is still in flight (a promise that never resolves).
  const inFlightFetch = new Promise<string>(() => {});
  // Writable async memo: loads the draft, but the user may type immediately.
  const [draft, setDraft] = createSignal<string>(() => inFlightFetch);
  const [verdict, setVerdict] = createSignal<Verdict>();

  // Probe what downstream consumers actually see (pending reads throw).
  let visible = "(never ran)";
  createRenderEffect(
    () => {
      try {
        visible = draft();
      } catch {
        visible = "(pending)";
      }
    },
    () => {}
  );

  async function typeWhileLoading() {
    // Per the writable-memo "manual value wins" contract, this synchronous
    // write must become the visible value even though a fetch is in flight.
    setDraft("edited by user");
    flush();
    await Promise.resolve();
    flush();

    setVerdict({
      ok: visible === "edited by user",
      actual: `wrote "edited by user"; the render effect sees "${visible}"`
    });
  }

  return (
    <main style={{ "font-family": "system-ui", padding: "16px" }}>
      <h2>Manual set() during an in-flight fetch</h2>
      <p>
        A manual set() while the fetch is pending should immediately become the visible value
        ("the manual value wins").
      </p>
      <button onClick={typeWhileLoading}>type while loading</button>
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
            <p>Expected the written value to be the visible value.</p>
            <pre>{v().actual}</pre>
          </section>
        )}
      </Show>
    </main>
  );
}
```

### Steps to Reproduce the Bug or Issue

1. Open the page. The writable async memo's initial fetch is in flight (it never resolves), so the render-effect probe reads `"(pending)"`.
2. Click **type while loading**. The handler performs a manual `setDraft("edited by user")` while the fetch is still in flight, then flushes.
3. On 2.0.0-beta.17 the page shows:

```text
FAIL - bug reproduced
wrote "edited by user"; the render effect sees "(pending)"
```

The write is silently dropped — the node stays pending, and (in the refetch variant) when the superseded fetch later resolves, its value overwrites the manual write.

### Expected behavior

The manual write becomes the visible value immediately and is not overwritten by the superseded in-flight fetch — per the documented "manual value wins" contract and the "optimistic local edit" description (signals.ts:268-273):

```text
PASS - bug is fixed
wrote "edited by user"; the render effect sees "edited by user"
```

### Screenshots or Videos

_No response_

### Platform

- OS: macOS
- Browser: Chrome
- Version: 2.0.0-beta.17 (re-verified at `next` @ `a51cac19`)

### Additional context

Two-part root cause in `packages/solid-signals/src/core/`:

1. `setSignal` (core.ts:976-977) writes `_pendingValue` on a `STATUS_PENDING` computed without clearing pending status / `_inFlight`, so consumers keep suspending on stale content past the write.
2. When the superseded promise resolves, `asyncWrite`'s stale-result guard (async.ts:208) checks only `REACTIVE_DIRTY | REACTIVE_OPTIMISTIC_DIRTY`; a manual write goes through `setMemo` → `suppressComputedRecompute` (core.ts:1001-1019), which sets `REACTIVE_MANUAL_WRITE` (cleared at pending-commit, scheduler.ts:534), so the guard never fires and `setSignal(el, () => value)` overwrites the user's write.

New in 2.0 (writable memos returning promises).

Repro test: `packages/solid-signals/tests/hunt2-writable-async-memo-race.test.ts` (2 failing — initial fetch and refetch — plus a passing control).

## Does this exist in Solid 1.x?

**Not applicable — new 2.0 API.** Writable memos whose body returns a promise have no Solid 1.x counterpart.
