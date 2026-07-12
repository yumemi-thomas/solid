# 2.0.0-beta.17: a memo recomputed twice in one flush loses the first run's cleanups and leaks child owners

### Describe the bug

If a memo recomputes a **second time within the same flush** — trivially triggered when a higher computation writes an `ownedWrite` signal the memo depends on (a documented coordination pattern, e.g. projections) — the first (superseded) run's `onCleanup` callbacks never fire and its child owners (nested effects/roots) are never disposed or unlinked. They stay subscribed as zombies for the life of the memo.

This bites any memo that registers per-run teardown. A dashboard panel that derives a live subscription from filters and cancels the previous subscription in `onCleanup` —

```ts
const filteredFeed = createMemo(() => {
  const controller = new AbortController();
  onCleanup(() => controller.abort());
  return subscribeToFeed(filters(), { signal: controller.signal });
});
```

— leaks one active subscription (listener, fetch) per double-recompute whenever a coordinating memo writes an `ownedWrite` signal during the same flush (to align a projection, selected row, or viewport window). No component owns the leaked subscription anymore.

The recomputes happening across **separate** flushes clean up correctly (the passing control) — the loss is specific to two recomputes inside one flush.

### Your Example Website or App

_StackBlitz link to be added — paste the code below into `src/App.tsx` of the standard SolidJS Vite template (`solid-js@2.0.0-beta.17`, `@solidjs/web@2.0.0-beta.17`, `jsxImportSource: "@solidjs/web"`)._

The repro is a feed memo that registers `onCleanup` per run, plus a coordinator memo that writes an `ownedWrite` signal mid-flush so the feed recomputes twice in one flush. Clicking the button changes the filter and checks which superseded runs' cleanups fired; a green **PASS** banner means the bug is fixed, a red **FAIL** banner means it reproduced.

```tsx
import { createEffect, createMemo, createSignal, flush, onCleanup, Show } from "solid-js";

type Verdict = { ok: boolean; actual: string };

export default function App() {
  const [filter, setFilter] = createSignal(0);
  const [aligned, setAligned] = createSignal(0, { ownedWrite: true });
  const [verdict, setVerdict] = createSignal<Verdict>();
  const cleanups: string[] = [];
  let runN = 0;

  // The feed: every run registers teardown for its subscription.
  const feed = createMemo(() => {
    filter();
    aligned();
    const id = runN++;
    onCleanup(() => cleanups.push(`run${id}`));
    return id;
  });
  // Higher computation that writes the ownedWrite signal during the flush,
  // re-dirtying `feed` after it already recomputed once in the same flush.
  const coordinator = createMemo(() => {
    feed();
    setAligned(filter());
    return filter();
  });
  createEffect(
    () => (feed(), coordinator()),
    () => {}
  );

  function changeFilter() {
    setFilter(1);
    flush();
    // feed ran twice inside this flush (run1 before the coordinator wrote the
    // ownedWrite signal, run2 after). Both superseded runs (run0 from mount
    // and run1) must have been cleaned up.
    const fired = cleanups.slice().sort().join(",");
    const missing = ["run0", "run1"].filter(id => !cleanups.includes(id));
    setVerdict({
      ok: fired === "run0,run1",
      actual: `superseded cleanups fired: [${fired}]${
        missing.length ? ` — ${missing.join(", ")} lost, onCleanup never ran` : ""
      }`
    });
  }

  return (
    <main style={{ "font-family": "system-ui", padding: "16px" }}>
      <h2>Superseded memo run's onCleanup never fires</h2>
      <p>current feed run: {feed()}</p>
      <button onClick={changeFilter}>change filter</button>
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
            <p>Expected both superseded runs' cleanups to fire: [run0,run1].</p>
            <pre>{v().actual}</pre>
          </section>
        )}
      </Show>
    </main>
  );
}
```

### Steps to Reproduce the Bug or Issue

1. Open the page — the feed memo has run once on mount (`run0` is the live run; no cleanups fired yet, correctly).
2. Click **change filter**. The write re-dirties both memos; during that single flush the coordinator memo writes the `ownedWrite` signal, so the feed memo recomputes twice (`run1`, then `run2`).
3. Both superseded runs (`run0` and `run1`) should have had their `onCleanup` fired. On 2.0.0-beta.17 the page shows:

```text
FAIL - bug reproduced
superseded cleanups fired: [run1] — run0 lost, onCleanup never ran
```

### Expected behavior

Every superseded run's `onCleanup` fires and its child owners are disposed, exactly as when the recomputes happen across separate flushes (the passing control):

```text
PASS - bug is fixed
superseded cleanups fired: [run0,run1]
```

### Screenshots or Videos

_No response_

### Platform

- OS: macOS
- Browser: Chrome
- Version: 2.0.0-beta.17 (re-verified at `next` @ `a51cac19`)

### Additional context

Root cause: non-create `recompute` in `packages/solid-signals/src/core/core.ts:162-170` blindly does `el._pendingDisposal = el._disposal; el._pendingFirstChild = el._firstChild`. A second recompute before `commitPendingNodes` overwrites the stash from the first, so the earlier run's disposal list and child chain are dropped without being committed.

Impact: a memo that registers per-run teardown (listener, AbortController) plus any same-tick write-through pattern leaks one teardown per double-recompute.

Repro test: `packages/solid-signals/tests/hunt2-memo-double-recompute-lost-cleanup.test.ts` (1 failing + separate-flush control).

## Does this exist in Solid 1.x?

**Not applicable — 2.0 machinery.** The pending-node commit mechanism (`_pendingDisposal`/`_pendingFirstChild`/`commitPendingNodes`) is specific to the 2.0 pull-based scheduler; 1.x has no equivalent double-recompute stash to clobber.
