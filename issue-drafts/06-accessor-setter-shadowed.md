# 2.0.0-beta.17: writing through an own accessor (get/set pair) never invokes the setter and kills the getter

### Describe the bug

A store built from an object with an own accessor pair (`get full()` / `set full(v)`) does not invoke the setter on write — the value lands as a plain data override. Worse, the get trap then prefers the override, so the getter is dead too: both validation/normalization in the setter and the derivation in the getter are silently lost.

This is the ordinary 1.x form-model shape (`get displayName()` returning a derived value, `set displayName(v)` normalizing into backing fields): after one write through the accessor, the setter's side effects never ran, and later edits to the backing fields no longer affect the derived property — the accessor pair has silently become a static data value. 1.x stores with `get`/`set` validation pairs migrate silently broken.

### Your Example Website or App

_StackBlitz link to be added — paste the code below into `src/App.tsx` of the standard SolidJS Vite template (`solid-js@2.0.0-beta.17`, `@solidjs/web@2.0.0-beta.17`, `jsxImportSource: "@solidjs/web"`)._

The repro is a cart line item whose `qty` is an accessor pair over a `_qty` backing field. Clicking the button writes through the accessor (the setter should run), then writes the backing field directly (a live getter must reflect it), and reports both halves in one banner.

```tsx
import { createSignal, createStore, flush, Show } from "solid-js";

type Verdict = { ok: boolean; actual: string };

export default function App() {
  const [item, setItem] = createStore({
    _qty: 1,
    get qty(): number {
      return this._qty;
    },
    set qty(v: number) {
      this._qty = v;
    }
  });
  const [verdict, setVerdict] = createSignal<Verdict>();

  function runBothWrites() {
    // 1. write through the accessor — the setter should run and update _qty
    setItem(s => {
      s.qty = 5;
    });
    flush();
    const backingAfterAccessorWrite = item._qty; // expected 5; actual 1

    // 2. write the backing field directly — a live getter must reflect it
    setItem(s => {
      s._qty = 9;
    });
    flush();
    const getterValue = item.qty; // expected 9; actual 5 (override shadows the getter)

    const setterOk = backingAfterAccessorWrite === 5;
    const getterOk = getterValue === 9;
    setVerdict({
      ok: setterOk && getterOk,
      actual: [
        `setter (2.0 regression): after qty = 5, backing _qty === ${backingAfterAccessorWrite} (expected 5)${setterOk ? "" : " — setter never ran"}`,
        `getter (long-standing):  after _qty = 9, qty === ${getterValue} (expected 9)${getterOk ? "" : " — getter shadowed by the override"}`
      ].join("\n")
    });
  }

  return (
    <main style={{ "font-family": "system-ui", padding: "16px" }}>
      <h2>Own accessor setter bypassed, getter killed</h2>
      <p>qty: {item.qty}</p>
      <button onClick={runBothWrites}>write qty = 5, then _qty = 9</button>
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

1. Click **write qty = 5, then _qty = 9**.
2. The first write goes through the accessor property — the setter never runs, so the backing `_qty` stays `1` while `qty` reads back the override value.
3. The second write updates the backing field directly — but `qty` still reads the stale override, because the data override now shadows the getter.

On 2.0.0-beta.17 the page shows:

```text
FAIL - bug reproduced
setter (2.0 regression): after qty = 5, backing _qty === 1 (expected 5) — setter never ran
getter (long-standing):  after _qty = 9, qty === 5 (expected 9) — getter shadowed by the override
```

### Expected behavior

Writing invokes the setter and the getter stays live. Solid 1.x invokes the setter (verified 1.9.14: the backing field becomes 5); 2.0 bypasses it entirely.

```text
PASS - bug is fixed
setter (2.0 regression): after qty = 5, backing _qty === 5 (expected 5)
getter (long-standing):  after _qty = 9, qty === 9 (expected 9)
```

### Screenshots or Videos

_No response_

### Platform

- OS: macOS
- Browser: Chrome
- Version: 2.0.0-beta.17 (re-verified at `next` @ `a51cac19`)

### Additional context

Root cause: the set trap (`packages/solid-signals/src/store/store.ts:551-634`) never consults the source property descriptor; the write becomes a plain `STORE_OVERRIDE`, and the get trap prefers the override (store.ts:443-447) while honoring accessors elsewhere (store.ts:449-450) — an internal asymmetry.

One adjacent surface to align when fixing this: `getPropertyDescriptor` (store.ts) deliberately returns the **base accessor descriptor unchanged** when an override shadows an accessor property — descriptor reporting for that corner should be revisited together with the setter fix, since today the reported `get` and the shadowing override disagree about the value. (The stale-descriptor fix for plain data writes explicitly left this corner untouched to avoid prejudging this issue's resolution.)

Repro test: `packages/solid-signals/tests/store/hunt2-accessor-setter-shadowed.test.ts` (2 failing + control). 1.x check: `hunt-1x-checks/checks/w2-store-accessor-setter.test.ts`.

## Does this exist in Solid 1.x?

**Regression (partial).** Verified 1.9.14: the setter *is* invoked on write (2.0 bypasses it). Both versions then shadow the getter with the written value, so the getter-death half is long-standing; the setter-bypass is new in 2.0.
