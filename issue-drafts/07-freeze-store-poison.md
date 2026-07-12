# 2.0.0-beta.17: `Object.freeze(store)` permanently poisons the store (enumeration, reads and writes all throw afterward)

### Describe the bug

Calling `Object.freeze()` on a store proxy doesn't reject or no-op — it forwards `[[PreventExtensions]]` to the internal target and thereafter every key enumeration, effect-tracking read, and write on that store throws:

- `Object.keys(state)` → `TypeError: 'ownKeys' on proxy: trap result did not include 'v'` (leaks the internal target's shape).
- writes / effect tracking → `TypeError: Cannot add property …, object is not extensible`.

Defensive freezes like `if (import.meta.env.DEV) Object.freeze(settings)` at a module boundary are a common idiom in shared libraries and app debugging helpers to catch accidental mutation. The problem is not that freezing a live store should make it immutable; it is that one freeze call silently corrupts the proxy so unrelated enumeration, spreading, JSON serialization, reads, and writes start throwing afterward.

### Your Example Website or App

_StackBlitz link to be added — paste the code below into `src/App.tsx` of the standard SolidJS Vite template (`solid-js@2.0.0-beta.17`, `@solidjs/web@2.0.0-beta.17`, `jsxImportSource: "@solidjs/web"`)._

The repro is a small settings store. Clicking the button attempts `Object.freeze(settings)`, then probes enumeration (`Object.keys`, spread, `JSON.stringify`) and a plain write, and reports both probes in one banner.

```tsx
import { createSignal, createStore, flush, Show } from "solid-js";

type Verdict = { ok: boolean; actual: string };

export default function App() {
  const [settings, setSettings] = createStore({ theme: "system", density: "compact" });
  const [verdict, setVerdict] = createSignal<Verdict>();

  function freezeAndProbe() {
    try {
      Object.freeze(settings);
    } catch {
      // acceptable: rejecting the freeze outright
    }

    // 1. ENUMERATION probe
    let enumerationOk = false;
    let enumeration: string;
    try {
      const keys = Object.keys(settings).sort().join(",");
      const spread = JSON.stringify({ ...settings });
      enumerationOk = keys === "density,theme" && spread === '{"theme":"system","density":"compact"}';
      enumeration = `keys=[${keys}], spread=${spread}`;
    } catch (e) {
      enumeration = `Object.keys(settings) threw: ${String(e)}`;
    }

    // 2. WRITE probe: creating the override on the now-non-extensible
    //    internal target throws.
    let writeOk = false;
    let write: string;
    try {
      setSettings(s => {
        s.theme = "dark";
      });
      flush();
      writeOk = settings.theme === "dark";
      write = `settings.theme === "${settings.theme}"`;
    } catch (e) {
      write = `setSettings threw: ${String(e)}`;
    }

    setVerdict({
      ok: enumerationOk && writeOk,
      actual: `enumeration: ${enumeration}\nwrite: ${write}`
    });
  }

  return (
    <main style={{ "font-family": "system-ui", padding: "16px" }}>
      <h2>Object.freeze poisons the store proxy</h2>
      <p>
        theme: {settings.theme}, density: {settings.density}
      </p>
      <button onClick={freezeAndProbe}>freeze store, then enumerate and write</button>
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

1. Click **freeze store, then enumerate and write**. The `Object.freeze(settings)` call itself does not throw — it silently reaches the internal target.
2. Every key enumeration on the store now throws the ownKeys proxy-invariant error (exposing the internal target's `v` key), and the subsequent `setSettings` write throws too.

On 2.0.0-beta.17 the page shows:

```text
FAIL - bug reproduced
enumeration: Object.keys(settings) threw: TypeError: 'ownKeys' on proxy: trap result did not include 'v'
write: setSettings threw: TypeError: Cannot add property …, object is not extensible
```

### Expected behavior

Freeze should either be rejected (trap returns `false` → `Object.freeze` throws cleanly, store still usable) or be a no-op — not silently break all later operations. Freezing "finished" config/state objects is a common defensive idiom.

```text
PASS - bug is fixed
enumeration: keys=[density,theme], spread={"theme":"system","density":"compact"}
write: settings.theme === "dark"
```

### Screenshots or Videos

_No response_

### Platform

- OS: macOS
- Browser: Chrome
- Version: 2.0.0-beta.17 (re-verified at `next` @ `a51cac19`)

### Additional context

Root cause: `storeTraps` (`packages/solid-signals/src/store/store.ts:409-752`) has no `preventExtensions`/`isExtensible` traps, so `Object.freeze` forwards to the internal `{v: source}` target; the engine then enforces the ownKeys invariant against the target's real keys, and every internal mutation of the target (`getNodes` 224-228, override creation 590) throws.

Suggested fix direction: define a `preventExtensions` trap that returns `false` (freeze throws cleanly and the store stays usable) — or make it a supported no-op — so `[[PreventExtensions]]` never reaches the internal target.

Repro test: `packages/solid-signals/tests/store/hunt2-freeze-store-proxy.test.ts` (2 failing). 1.x check: `hunt-1x-checks/checks/w2-store-freeze.test.ts`.

## Does this exist in Solid 1.x?

**Also broken in 1.x** (not a regression) but with a narrower blast radius: verified 1.9.14 — freeze causes a throw when the store next tries to create tracking nodes (`Cannot define property Symbol(store-node), object is not extensible`), rather than 2.0's ownKeys-invariant leak plus poisoned writes.
