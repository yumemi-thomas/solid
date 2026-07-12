# 2.0.0-beta.17: `mapArray`/`repeat` recreates a falsy fallback on every empty update and leaks its owner

### Describe the bug

A `mapArray`/`repeat` fallback that returns a falsy value (`null`, `0`, `""`, `false`) is re-created on every update that keeps the collection empty, and each recreation overwrites the cached owner without disposing the previous one — leaking one owner (and its `onCleanup`/effects) per empty update. A truthy fallback behaves correctly (created once, disposed once — the passing control), so the bug is specifically the falsy return value.

Falsy fallbacks are a deliberate choice, not an oddity. A virtualized table that renders nothing for an empty viewport because a surrounding component already owns the empty state —

```ts
const rows = mapArray(visibleRows, row => <Row row={row} />, { fallback: () => null });
```

— re-runs the fallback on every filter change, poll, or viewport recalculation that keeps `visibleRows` empty (each fresh `[]` identity re-runs the map), leaking a fallback owner each time even though the fallback intentionally renders `null`.

### Your Example Website or App

_StackBlitz link to be added — paste the code below into `src/App.tsx` of the standard SolidJS Vite template (`solid-js@2.0.0-beta.17`, `@solidjs/web@2.0.0-beta.17`, `jsxImportSource: "@solidjs/web"`)._

The repro maps an empty row list with a `null`-returning fallback that counts its creations and registers `onCleanup`. Clicking the button performs two more empty updates (fresh `[]` identity each, like a poll returning no rows), then loads a row, and checks the creation count and how many fallback owners were never disposed; a green **PASS** banner means the bug is fixed, a red **FAIL** banner means it reproduced.

```tsx
import { createEffect, createSignal, flush, mapArray, onCleanup, Show } from "solid-js";

type Verdict = { ok: boolean; actual: string };

export default function App() {
  const [rows, setRows] = createSignal<number[]>([]);
  const [verdict, setVerdict] = createSignal<Verdict>();
  let created = 0;
  const disposed: number[] = [];

  // Virtualized-table style mapping: the fallback intentionally renders nothing.
  const mapped = mapArray(rows, x => x, {
    fallback: () => {
      const id = created++;
      onCleanup(() => disposed.push(id));
      return null; // falsy fallback
    }
  });
  createEffect(mapped, () => {});

  function pollThenLoad() {
    // two more empty updates (fresh [] identity each) — should keep the ONE
    // fallback owner created on mount
    setRows([]);
    flush();
    setRows([]);
    flush();
    const createdWhileEmpty = created; // expected 1

    // now go non-empty: every fallback owner created must be disposed
    setRows([1]);
    flush();
    const leaked = created - disposed.length;

    setVerdict({
      ok: createdWhileEmpty === 1 && leaked === 0,
      actual: `fallback created ${createdWhileEmpty}× while empty, ${leaked} owner(s) leaked after non-empty`
    });
  }

  return (
    <main style={{ "font-family": "system-ui", padding: "16px" }}>
      <h2>mapArray falsy fallback recreated and leaked</h2>
      <p>rows: {JSON.stringify(rows())}</p>
      <button onClick={pollThenLoad}>poll twice, then load a row</button>
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
            <p>Expected the fallback created once while empty and 0 owners leaked.</p>
            <pre>{v().actual}</pre>
          </section>
        )}
      </Show>
    </main>
  );
}
```

### Steps to Reproduce the Bug or Issue

1. Open the page — the empty list created the fallback once on mount (correct so far).
2. Click **poll twice, then load a row**. The handler performs two more empty updates (fresh `[]` identity each) with a flush after each, then sets a non-empty list and flushes.
3. The fallback should have been created once in total, and every fallback owner should be disposed once the list is non-empty. On 2.0.0-beta.17 the page shows:

```text
FAIL - bug reproduced
fallback created 3× while empty, 1 owner(s) leaked after non-empty
```

### Expected behavior

The fallback is created once while the collection stays empty and its owner is disposed when the collection becomes non-empty — as a truthy fallback already behaves (passing control):

```text
PASS - bug is fixed
fallback created 1× while empty, 0 owner(s) leaked after non-empty
```

### Screenshots or Videos

_No response_

### Platform

- OS: macOS
- Browser: Chrome
- Version: 2.0.0-beta.17 (re-verified at `next` @ `a51cac19`)

### Additional context

Root cause: `packages/solid-signals/src/map.ts:152` and `:334` — fallback existence is tested by truthiness of the cached mapped value (`this._fallback && !this._mappings[0]`), so a falsy fallback value always re-runs; only the latest owner is disposed (map.ts:163/347). `repeat` shares the same pattern at map.ts:334, so a falsy `repeat` fallback (`() => 0`) is re-created identically while `count` stays 0.

Real-world: `mapArray(rows, render, { fallback: () => null })` over a list that repeatedly receives fresh empty arrays (a poll returning `[]`).

Repro test: `packages/solid-signals/tests/hunt2-map-falsy-fallback.test.ts` (3 failing — mapArray create-once, mapArray dispose-all, repeat create-once — plus a truthy-fallback control). 1.x check: `w2-core-map-falsy-fallback.test.ts`.

## Does this exist in Solid 1.x?

**Also broken in 1.x** (not a regression): verified 1.9.14 — the falsy fallback is created 3 times over 3 empty updates with one owner left undisposed.
