# 2.0.0-beta.17: a memo that errors then heals to an `equals`-equal value never clears the error downstream

### Describe the bug

When a memo throws, the error propagates downstream (effects show the error, `<Errored>` catches). When the memo later recomputes back to a value **equal to its last good value**, downstream consumers are never told the error cleared:

1. Effects don't re-run — they stay on the error state.
2. Downstream memos keep `STATUS_ERROR`, and untracked reads of them throw the stale error indefinitely.

Healing to a *different* value recovers fine — so the bug is specifically the equal-value heal.

The equal-value heal is a natural shape, not a corner case. A profile page deriving a display label —

```ts
const label = createMemo(() => {
  const user = loadUser(userId());
  if (!user.canView) throw new Error("not allowed");
  return user.displayName || "Anonymous";
});
```

— that throws a transient permission error and then recovers recomputes to the same string it had before the error (`"Anonymous"`). The UI should leave the error fallback and show the label again, but downstream consumers stay stuck in the stale error state because the value is `equals`-equal to the last good value.

### Your Example Website or App

_StackBlitz link to be added — paste the code below into `src/App.tsx` of the standard SolidJS Vite template (`solid-js@2.0.0-beta.17`, `@solidjs/web@2.0.0-beta.17`, `jsxImportSource: "@solidjs/web"`)._

The repro is a memo that throws while permission is denied and otherwise always returns the same label, observed by an effect and by a chained downstream memo. Clicking the button denies then restores permission and checks both the effect recovery and an untracked read of the chained memo; a green **PASS** banner means the bug is fixed, a red **FAIL** banner means it reproduced.

```tsx
import { createEffect, createMemo, createSignal, flush, Show, untrack } from "solid-js";

type Verdict = { ok: boolean; actual: string };

class Boom extends Error {}

export default function App() {
  const [permission, setPermission] = createSignal(1); // 1 = allowed, 2 = denied
  const [verdict, setVerdict] = createSignal<Verdict>();
  const values: string[] = [];
  const errors: unknown[] = [];

  const label = createMemo(() => {
    if (permission() === 2) throw new Boom("boom");
    return "Anonymous"; // always the same good value
  });
  const chained = createMemo(() => label()); // downstream memo for the untracked-read probe
  createEffect(chained, { effect: () => {}, error: () => {} }); // keep it live
  createEffect(label, {
    effect: v => {
      values.push(v);
    },
    error: err => {
      errors.push(err);
    }
  });

  async function denyThenRestore() {
    setPermission(2); // memo throws → error observed downstream
    flush();
    setPermission(1); // memo heals to "Anonymous" — equal to its last good value
    flush();
    await Promise.resolve();
    flush();

    // untracked read of the chained (downstream) memo after the heal:
    // it should return "Anonymous" but keeps throwing the stale error
    let untrackedError: unknown = null;
    try {
      untrack(chained);
    } catch (err) {
      untrackedError = err;
    }

    const effectRecovered = values.length === 2 && values[1] === "Anonymous";
    setVerdict({
      ok: effectRecovered && untrackedError === null,
      actual: [
        `values = [${values.map(v => JSON.stringify(v)).join(", ")}], errors observed = ${errors.length}` +
          (effectRecovered ? "" : " (effect never recovered from the error)"),
        untrackedError !== null
          ? `untracked chained read still throws: ${String(untrackedError)}`
          : "untracked chained read returned normally"
      ].join("\n")
    });
  }

  return (
    <main style={{ "font-family": "system-ui", padding: "16px" }}>
      <h2>Error heal to an equal value</h2>
      <p>
        When an errored memo recomputes back to a value equal to its last good value, downstream
        consumers should observe the recovery.
      </p>
      <button onClick={denyThenRestore}>deny then restore permission</button>
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
            <p>Expected the effect to re-run on heal and the chained memo to stop throwing.</p>
            <pre>{v().actual}</pre>
          </section>
        )}
      </Show>
    </main>
  );
}
```

### Steps to Reproduce the Bug or Issue

1. Click **deny then restore permission**. The handler sets the signal to the throwing value and flushes (the effect's error callback observes the error), then sets it back and flushes — the memo recomputes successfully to `"Anonymous"`, equal to its last good value.
2. The effect should re-run with the healed value, and an untracked read of the chained downstream memo should return it. On 2.0.0-beta.17 the page shows:

```text
FAIL - bug reproduced
values = ["Anonymous"], errors observed = 1 (effect never recovered from the error)
untracked chained read still throws: Error: boom
```

Clicking again keeps throwing the same stale error — the downstream error state never clears.

### Expected behavior

Healing clears the error downstream and effects recover, per the migration docs ("error boundaries heal automatically", MIGRATION.md:971) — matching the different-value heal control:

```text
PASS - bug is fixed
values = ["Anonymous", "Anonymous"], errors observed = 1
untracked chained read returned normally
```

### Screenshots or Videos

_No response_

### Platform

- OS: macOS
- Browser: Chrome
- Version: 2.0.0-beta.17 (re-verified at `next` @ `a51cac19`)

### Additional context

Root cause: `packages/solid-signals/src/core/core.ts:277-315` — after a successful recompute, `insertSubs` runs only when `valueChanged` (compared against the pre-error `_value`), so an equal-value heal notifies nobody. Error status was pushed downstream eagerly via `notifyStatus` (async.ts:356-436), but there is no error analog of `settlePendingSource` (async.ts:112) to clear downstream `STATUS_ERROR`/`_error`. The tracked-read retry (core.ts:816-825) needs `tracking`, so untracked reads keep throwing.

Repro test: `packages/solid-signals/tests/hunt2-error-heal-equal-value.test.ts` (2 failing + different-value-heal control).

## Does this exist in Solid 1.x?

**Not applicable — 2.0 async error-status system.** The eager `STATUS_ERROR` propagation and pending/settle machinery are specific to 2.0; 1.x error handling (`catchError`) has no equal-value-heal notification path to miss.
