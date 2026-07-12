# 2.0.0-beta.17: an unhandled throw in one effect permanently drops sibling effects queued in the same flush

### Describe the bug

When one user effect throws (and no boundary handles it), the remaining effects queued in the **same flush** are discarded — and because those nodes already recomputed, they are never re-enqueued, so their updates are lost permanently (not just deferred). One buggy effect throwing once silently desyncs unrelated parts of the app for that update.

The failure couples code that has nothing to do with each other. A page with one effect that writes analytics and another, unrelated effect that syncs UI state to the DOM:

```ts
createEffect(
  () => route(),
  route => analytics.track("route", route) // throws once because the analytics SDK is missing
);

createEffect(
  () => route(),
  route => (document.body.dataset.route = route.id)
);
```

The analytics failure is already a bug, but it should not permanently drop the sibling DOM sync that was queued in the same flush. With the current scheduler behavior, the body dataset update is lost for that route transition and never retried.

### Your Example Website or App

_StackBlitz link to be added — paste the code below into `src/App.tsx` of the standard SolidJS Vite template (`solid-js@2.0.0-beta.17`, `@solidjs/web@2.0.0-beta.17`, `jsxImportSource: "@solidjs/web"`)._

The repro has two effects tracking the same signal: the first throws when it sees the new value, the second just records what it observed. Clicking the button performs the write (the handler catches the error that propagates out of `flush()`) and checks whether the sibling effect still ran; a green **PASS** banner means the bug is fixed, a red **FAIL** banner means it reproduced.

```tsx
import { createEffect, createSignal, flush, Show } from "solid-js";

type Verdict = { ok: boolean; actual: string };

export default function App() {
  const [route, setRoute] = createSignal(0);
  const [verdict, setVerdict] = createSignal<Verdict>();
  const log: number[] = [];

  // Buggy effect: throws once when it sees the new route.
  createEffect(route, v => {
    if (v === 1) throw new Error("boom");
  });
  // Unrelated sibling effect queued in the same flush.
  createEffect(route, v => {
    log.push(v);
  });

  function navigate() {
    setRoute(1);
    try {
      flush();
    } catch {
      // the unhandled effect error is expected to propagate out of flush()
    }
    const ok = log.length === 2 && log[1] === 1;
    setVerdict({
      ok,
      actual: `log = [${log.join(", ")}]${ok ? "" : " — sibling update dropped"}`
    });
  }

  return (
    <main style={{ "font-family": "system-ui", padding: "16px" }}>
      <h2>Throwing effect drops sibling effects</h2>
      <p>
        A throw in one effect should not drop other effects' updates queued in the same flush.
      </p>
      <button onClick={navigate}>navigate</button>
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
            <p>Expected the sibling effect to still observe v === 1 (log = [0, 1]).</p>
            <pre>{v().actual}</pre>
          </section>
        )}
      </Show>
    </main>
  );
}
```

### Steps to Reproduce the Bug or Issue

1. Open the page — both effects have run once on mount (the sibling logged `0`).
2. Click **navigate**. Both effects are queued in the same flush; the first throws, and the handler catches the error that propagates out of `flush()`.
3. The unrelated sibling effect should still observe the new value. On 2.0.0-beta.17 the page shows:

```text
FAIL - bug reproduced
log = [0] — sibling update dropped
```

The sibling's update is not retried on later flushes either — its node already recomputed, so the observation is lost permanently.

### Expected behavior

A throw in one effect does not drop other effects' updates in the same flush (each effect's execution should be isolated):

```text
PASS - bug is fixed
log = [0, 1]
```

### Screenshots or Videos

_No response_

### Platform

- OS: macOS
- Browser: Chrome
- Version: 2.0.0-beta.17 (re-verified at `next` @ `a51cac19`)

### Additional context

Root cause: `packages/solid-signals/src/core/scheduler.ts:687-689` (`runQueue`, no per-callback isolation) + `Queue.run` detaching the callbacks array before running (260-262) + the rethrow at `effect.ts:145`. #2761/#2762 (f0bdfad8) fixed scheduler *state* recovery so later flushes work — but not the same-flush sibling loss.

Repro test: `packages/solid-signals/tests/hunt2-throwing-effect-drops-sibling-effects.test.ts` (1 failing). 1.x check: `w2-core-throwing-effect-siblings.test.ts`.

## Does this exist in Solid 1.x?

**Also broken in 1.x** (not a regression): verified 1.9.14 — a throwing effect in a `batch` drops the sibling effect's update the same way (`seen: [0]`). Long-standing.
