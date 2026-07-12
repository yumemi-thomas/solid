# 2.0.0-beta.17: an effect that disposes its own boundary skips a sibling boundary's queued effects for that flush

### Describe the bug

When an effect inside boundary A disposes A (e.g. "close this panel when done"), a sibling boundary B's effects queued in the same flush do not run, and no new flush is scheduled — they only run when some later, unrelated write triggers the next flush. Render effects are affected too, so DOM updates can be deferred indefinitely.

The self-closing-panel shape is common: a checkout page with two independent async panels — a coupon validation panel that closes itself when the coupon is applied, and an order summary panel updating totals:

```ts
createEffect(
  () => couponStatus(),
  status => {
    if (status === "applied") disposeCouponPanel();
  }
);

createEffect(
  () => cartTotals(),
  totals => updateSummaryDom(totals)
);
```

If both panels have queued effects in the same flush, disposing the coupon boundary makes the sibling summary boundary miss its queued update — the total in the UI stays stale until some unrelated write happens.

### Your Example Website or App

_StackBlitz link to be added — paste the code below into `src/App.tsx` of the standard SolidJS Vite template (`solid-js@2.0.0-beta.17`, `@solidjs/web@2.0.0-beta.17`, `jsxImportSource: "@solidjs/web"`)._

Because the bug is specifically about an effect **synchronously disposing its own boundary mid-flush**, boundary A is a manually created `createRoot` + `createLoadingBoundary` whose own effect calls the dispose function (a `<Show>` unmount goes through a scheduled write and doesn't exercise the same mid-queue splice). Boundary B is a plain sibling loading boundary. Clicking the button triggers both boundaries' effects in one flush; a green **PASS** banner means the bug is fixed, a red **FAIL** banner means it reproduced.

```tsx
import { createEffect, createLoadingBoundary, createRoot, createSignal, flush, Show } from "solid-js";

type Verdict = { ok: boolean; actual: string };

export default function App() {
  const [step, setStep] = createSignal(0);
  const [verdict, setVerdict] = createSignal<Verdict>();
  const log: string[] = [];
  let disposeCouponPanel!: () => void;

  // Boundary A: the coupon panel — its own effect disposes it when applied.
  createRoot(d => {
    disposeCouponPanel = d;
    createLoadingBoundary(
      () => {
        createEffect(step, v => {
          log.push(`a${v}`);
          if (v === 1) disposeCouponPanel(); // coupon applied → close this panel
        });
        return "A";
      },
      () => "loadingA"
    );
  });
  // Boundary B: the sibling order-summary panel.
  createLoadingBoundary(
    () => {
      createEffect(step, v => {
        log.push(`b${v}`);
      });
      return "B";
    },
    () => "loadingB"
  );

  function applyCoupon() {
    setStep(1);
    flush();
    const ok = log.includes("b1");
    setVerdict({
      ok,
      actual: `log = [${log.join(", ")}]${ok ? "" : " — b1 missing"}`
    });
  }

  return (
    <main style={{ "font-family": "system-ui", padding: "16px" }}>
      <h2>Sibling boundary's effect skipped on dispose</h2>
      <p>
        Both boundaries' effects track the same signal; boundary A's effect disposes A when it
        sees the update. Boundary B's queued effect should still run in that flush.
      </p>
      <button onClick={applyCoupon}>apply coupon</button>
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
            <p>Expected boundary B to observe v === 1 (log contains "b1").</p>
            <pre>{v().actual}</pre>
          </section>
        )}
      </Show>
    </main>
  );
}
```

### Steps to Reproduce the Bug or Issue

1. Open the page — both boundaries' effects have run once on mount (`a0`, `b0`).
2. Click **apply coupon**. Both boundaries' effects are queued for the same flush; boundary A's effect runs first, logs `a1`, and disposes its own panel.
3. Sibling boundary B's already-queued effect should still run in that flush. On 2.0.0-beta.17 the page shows:

```text
FAIL - bug reproduced
log = [a0, b0, a1] — b1 missing
```

No new flush is scheduled either — `b1` only appears after some later, unrelated write triggers the next flush.

### Expected behavior

Disposing boundary A does not prevent sibling boundary B's already-queued effects (including render effects) from running in that flush:

```text
PASS - bug is fixed
log = [a0, b0, a1, b1]
```

### Screenshots or Videos

_No response_

### Platform

- OS: macOS
- Browser: Chrome
- Version: 2.0.0-beta.17 (re-verified at `next` @ `a51cac19`)

### Additional context

Root cause: `packages/solid-signals/src/core/scheduler.ts:259-266` — `Queue.run` iterates `_children` by live index; the boundary-dispose cleanup calls `removeChild` (scheduler.ts:248-254), which splices A's queue out and shifts sibling B into the already-visited slot. B's queued callbacks stay in its queue and no re-flush is scheduled.

Real-world: an effect inside a `<Loading>`/`<Errored>` region that unmounts its own region leaves sibling boundaries' effects frozen until the next unrelated state change.

Repro test: `packages/solid-signals/tests/hunt2-boundary-dispose-skips-sibling-queue.test.ts` (1 failing).

## Does this exist in Solid 1.x?

**Not applicable — 2.0 scheduler.** The `Queue`/`_children` boundary-queue structure is specific to the 2.0 scheduler.
