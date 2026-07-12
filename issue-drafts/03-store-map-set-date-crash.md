# 2.0.0-beta.17: `Map`/`Set`/`Date` values in a store crash on internal-slot access and on any method call inside a setter

### Describe the bug

`createStore` in 2.0 wraps any non-frozen object (its `isWrappable` only excludes `null`, non-objects, frozen objects, and DOM `Node`s — 1.x additionally excluded non-plain objects). So `createStore({ cache: new Map(), createdAt: new Date() })` is now a natural thing to write — it is the ordinary shape apps use for lookup tables, selected-row sets, and date values. But two sibling gaps in the store's `get` trap make built-ins with internal slots unusable:

1. **Reading an internal-slot accessor throws.** `state.cache.size`, `state.tags.size` throw `TypeError: Method get Map.prototype.size called on incompatible receiver #<Object>`. The read path invokes inherited accessors via `Reflect.get(storeValue, property, receiver)` with the **proxy** as the receiver; proxies don't forward internal slots, so the native getter rejects it.
2. **Calling a method inside a setter draft throws.** `setState(s => s.cache.set(k, v))`, `s.tags.add(x)`, `s.at.setFullYear(2021)` throw `Method Map.prototype.set called on incompatible receiver`. The write (`writeOnly`) branch returns prototype methods **unbound**, unlike the read branch which binds them to the raw value.

The boundary of the bug, for contrast: plain reads that happen to be generic (`Map.prototype.get`, `Date.prototype.getTime`) work, which makes the failure feel random. Because 2.0 wraps these values as store objects, the first render or update that touches `.size` or a mutator can throw before any app code sees a useful Solid diagnostic.

### Your Example Website or App

_StackBlitz link to be added — paste the code below into `src/App.tsx` of the standard SolidJS Vite template (`solid-js@2.0.0-beta.17`, `@solidjs/web@2.0.0-beta.17`, `jsxImportSource: "@solidjs/web"`)._

The repro is a small admin panel keeping a user lookup `Map`, a selected-ids `Set`, and a trial-expiry `Date` in one store. Clicking the button runs each affected read and setter-draft write once (plus two generic-method controls that already work) and lists per-case results in a PASS/FAIL banner.

```tsx
import { createSignal, createStore, flush, Show } from "solid-js";

type Verdict = { ok: boolean; actual: string };

export default function App() {
  const [store, setStore] = createStore({
    usersById: new Map([["u1", "Ada"]]),
    selectedIds: new Set(["u1", "u2"]),
    trialEndsAt: new Date(2020, 0, 1)
  });
  const [verdict, setVerdict] = createSignal<Verdict>();

  function runAllProbes() {
    const cases: Array<{ label: string; run: () => boolean }> = [
      // 1. READ path: internal-slot accessors invoked with the proxy as receiver.
      { label: "read  usersById.size (expect 1)", run: () => store.usersById.size === 1 },
      { label: "read  selectedIds.size (expect 2)", run: () => store.selectedIds.size === 2 },
      // 2. WRITE path: built-in methods returned unbound inside the setter draft.
      {
        label: 'write usersById.set("u2", "Grace")',
        run: () => {
          setStore(s => {
            s.usersById.set("u2", "Grace");
          });
          flush();
          return store.usersById.get("u2") === "Grace";
        }
      },
      {
        label: 'write selectedIds.add("u3")',
        run: () => {
          setStore(s => {
            s.selectedIds.add("u3");
          });
          flush();
          return store.selectedIds.has("u3");
        }
      },
      {
        label: "write trialEndsAt.setFullYear(2021)",
        run: () => {
          setStore(s => {
            s.trialEndsAt.setFullYear(2021);
          });
          flush();
          return store.trialEndsAt.getFullYear() === 2021;
        }
      },
      // Controls: generic prototype methods work today (the read path binds them).
      { label: 'control usersById.get("u1")', run: () => store.usersById.get("u1") === "Ada" },
      { label: "control trialEndsAt.getTime()", run: () => Number.isFinite(store.trialEndsAt.getTime()) }
    ];

    const lines = cases.map(c => {
      try {
        return `${c.label}: ${c.run() ? "ok" : "wrong value"}`;
      } catch (e) {
        return `${c.label}: threw ${String(e)}`;
      }
    });
    setVerdict({ ok: lines.every(line => line.endsWith(": ok")), actual: lines.join("\n") });
  }

  return (
    <main style={{ "font-family": "system-ui", padding: "16px" }}>
      <h2>Map/Set/Date values in a store</h2>
      <p>cached user u1: {store.usersById.get("u1")} (generic Map.get — the read that still works)</p>
      <button onClick={runAllProbes}>run Map/Set/Date probes</button>
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

1. Note the page already renders `cached user u1: Ada` — a generic method (`Map.prototype.get`) works fine through the store proxy.
2. Click **run Map/Set/Date probes**. Every internal-slot read (`.size`) and every built-in method call inside a setter draft (`.set`, `.add`, `.setFullYear`) throws, while the two generic-method controls pass.

On 2.0.0-beta.17 the page shows:

```text
FAIL - bug reproduced
read  usersById.size (expect 1): threw TypeError: Method get Map.prototype.size called on incompatible receiver #<Object>
read  selectedIds.size (expect 2): threw TypeError: Method get Set.prototype.size called on incompatible receiver #<Object>
write usersById.set("u2", "Grace"): threw TypeError: Method Map.prototype.set called on incompatible receiver #<Object>
write selectedIds.add("u3"): threw TypeError: Method Set.prototype.add called on incompatible receiver #<Object>
write trialEndsAt.setFullYear(2021): threw TypeError: Method Date.prototype.setFullYear called on incompatible receiver #<Object>
control usersById.get("u1"): ok
control trialEndsAt.getTime(): ok
```

### Expected behavior

Reading `.size` returns the count, and methods called on a setter draft mutate the underlying built-in — as in Solid 1.x (verified on 1.9.14: all of the above work):

```text
PASS - bug is fixed
read  usersById.size (expect 1): ok
read  selectedIds.size (expect 2): ok
write usersById.set("u2", "Grace"): ok
write selectedIds.add("u3"): ok
write trialEndsAt.setFullYear(2021): ok
control usersById.get("u1"): ok
control trialEndsAt.getTime(): ok
```

### Screenshots or Videos

_No response_

### Platform

- OS: macOS
- Browser: Chrome
- Version: 2.0.0-beta.17 (re-verified at `next` @ `a51cac19`)

### Additional context

Root cause in `packages/solid-signals/src/store/store.ts` — read path `store.ts:451-455` (`Reflect.get(..., receiver)` with the proxy as receiver), write path `store.ts:458-474` (methods returned unbound; the read path at `store.ts:481-492` does `value.bind(storeValue)`). `isWrappable` at `store.ts:149`.

Suggested fix direction: either fully support internal-slot built-ins (invoke inherited accessors with the raw store value as receiver, and bind prototype methods in the `writeOnly` branch the way the read branch does), or exclude them from `isWrappable` (treat them as opaque leaves) so at least reads and whole-value replacement work.

Related: `reconcile()` has an independent gap with the same class of values — a changed `Date`/`Map`/`Set` leaf updates the raw store value without ever notifying subscribers (filed separately).

Repro test: `packages/solid-signals/tests/store/hunt2-map-set-date-builtins.test.ts` (5 failing + 2 passing controls).

## Does this exist in Solid 1.x?

**Regression.** Verified against solid-js 1.9.14 (`hunt-1x-checks/checks/w2-store-map-set-date.test.ts`): `.size` reads and `Map.set`/`Date.setFullYear` inside a `produce` draft all work — 1.x's `isWrappable` excludes non-plain objects, so built-ins are stored as opaque leaves.
