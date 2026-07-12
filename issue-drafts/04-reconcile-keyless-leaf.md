# 2.0.0-beta.17: `reconcile()` updates but never notifies for `Date`/`Map`/`Set` leaf values

### Describe the bug

When `reconcile()` diffs a property whose value is a wrappable object with **no own enumerable keys** (`Date`, `Map`, `Set`, `RegExp`), it recurses into the value, swaps the underlying store value, then diffs own enumerable keys — of which there are none. So the new value is committed to the store's raw state but **no subscriber is ever notified**.

This is a heisenbug: `state.updatedAt` (untracked) already returns the new date, but the effect/JSX tracking it never re-runs — until some *unrelated* update triggers a re-render, at which point the "new" value suddenly appears. It is a real-app hit for the ordinary `setTasks(reconcile(serverPayload, "id"))` background-sync pattern where rows carry `updatedAt: Date`: server timestamps change but the UI keeps showing the old time, which makes the app look stale and nondeterministic. A `Map` leaf behaves identically (covered by the repro test).

### Your Example Website or App

_StackBlitz link to be added — paste the code below into `src/App.tsx` of the standard SolidJS Vite template (`solid-js@2.0.0-beta.17`, `@solidjs/web@2.0.0-beta.17`, `jsxImportSource: "@solidjs/web"`)._

The repro renders a task with a last-edited `Date` and tracks it with an effect. Clicking the button reconciles a server payload whose only change is the `Date` leaf, then checks whether the effect re-ran; the stale label above the banner shows the same bug in JSX.

```tsx
import { createEffect, createSignal, createStore, flush, reconcile, Show } from "solid-js";

type Verdict = { ok: boolean; actual: string };

export default function App() {
  const [task, setTask] = createStore({ title: "Ship beta", updatedAt: new Date(2020, 0, 1) });
  const [verdict, setVerdict] = createSignal<Verdict>();

  let effectRuns = 0;
  createEffect(
    () => task.updatedAt.getTime(),
    () => {
      effectRuns++;
    }
  );

  function syncFromServer() {
    // reconcile a server payload whose only change is the Date leaf.
    // (reconcile's key argument is required by its signature; it goes unused
    // here because the changed value is a keyless Date leaf — exactly the bug.)
    setTask(reconcile({ title: "Ship beta", updatedAt: new Date(2021, 5, 5) }, "id"));
    flush();

    const rawYear = task.updatedAt.getFullYear(); // the raw value DID update -> 2021
    setVerdict({
      ok: effectRuns === 2,
      actual: `store value updated to ${rawYear}; tracking effect ran ${effectRuns}x (expected 2x)`
    });
  }

  return (
    <main style={{ "font-family": "system-ui", padding: "16px" }}>
      <h2>reconcile() skips Date/Map/Set leaf changes</h2>
      <p>
        {task.title} — last edited: {task.updatedAt.toDateString()}
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
            <pre>{v().actual}</pre>
          </section>
        )}
      </Show>
    </main>
  );
}
```

### Steps to Reproduce the Bug or Issue

1. The page renders `Ship beta — last edited: Wed Jan 01 2020`.
2. Click **sync from server** — the reconciled payload carries `updatedAt: new Date(2021, 5, 5)`.
3. The last-edited label does not change, even though reading the store now returns the 2021 date.

On 2.0.0-beta.17 the page shows:

```text
FAIL - bug reproduced
store value updated to 2021; tracking effect ran 1x (expected 2x)
```

The last-edited label above the banner still shows `Wed Jan 01 2020` — the JSX tracking the date never re-ran.

### Expected behavior

Changing a `Date`/`Map`/`Set` leaf via `reconcile` notifies its subscribers, as in Solid 1.x (verified 1.9.14: the effect re-runs with 2021). These should be treated as leaves — `prev !== next` → replace + notify:

```text
PASS - bug is fixed
store value updated to 2021; tracking effect ran 2x (expected 2x)
```

and the last-edited label reads `Sat Jun 05 2021`.

### Screenshots or Videos

_No response_

### Platform

- OS: macOS
- Browser: Chrome
- Version: 2.0.0-beta.17 (re-verified at `next` @ `a51cac19`)

### Additional context

Root cause: `packages/solid-signals/src/store/reconcile.ts` values branch (`applyStateFast` lines 184-205 / `applyStateSlow` 334-355) — both values wrappable, same array-ness, null key → recurse and diff own enumerable keys; keyless objects yield no `setSignal`/`notifySelf`.

A plain draft write of a new `Date` (`setState(s => { s.d = new Date(...) })`) notifies fine — only the reconcile path is broken (control in the repro test).

Related: distinct from the array-shrink (#2823) and store-proxy (#2825) reconcile issues, from the symbol-key notification gap, and from the `Map`/`Set`/`Date` store crashes on internal-slot access (filed separately).

Repro test: `packages/solid-signals/tests/store/hunt2-reconcile-keyless-leaf.test.ts` (2 failing + control).

## Does this exist in Solid 1.x?

**Regression.** Verified against 1.9.14 (`hunt-1x-checks/checks/w2-store-reconcile-keyless-leaf.test.ts`): both the `Date` and `Map` effects re-run with the new value. 1.x treats keyless wrappables as leaves.
