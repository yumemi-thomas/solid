# 2.0.0-beta.17: dev build crashes on any frozen / non-extensible component function (prod works)

### Describe the bug

Rendering a frozen component function throws in the dev build (`Cannot add property Symbol(COMPONENT_DEV), object is not extensible`) for both `<Dynamic component={Object.freeze(Comp)}/>` and direct JSX `<Frozen/>`. The prod build works — a dev/prod divergence. The dev path also mutates the user's function (it tags every component by writing a symbol onto it).

Freezing component functions is what a plugin system does so plugins cannot monkey-patch each other:

```tsx
export const PaymentWidget = Object.freeze(function PaymentWidget(props: Props) {
  return <section>{props.children}</section>;
});

<Dynamic component={PaymentWidget} />
```

This works in production but crashes in development, so local dev fails only for hardened/plugin components, even though the same component is otherwise valid JSX.

### Your Example Website or App

_StackBlitz link to be added — paste the code below into `src/App.tsx` of the standard SolidJS Vite template (`solid-js@2.0.0-beta.17`, `@solidjs/web@2.0.0-beta.17`, `jsxImportSource: "@solidjs/web"`)._

This bug is **dev-build-only**: run the repro with the Vite dev server (StackBlitz's default); a production build renders the same components fine and shows PASS. Clicking **mount frozen widget** tries to render one frozen component both through `<Dynamic>` and as direct JSX (each into a scratch container, inside try/catch so the page survives the crash), then renders the verdict: green **PASS** if both rendered, red **FAIL** with the thrown errors.

```tsx
import { createSignal, Show } from "solid-js";
import { Dynamic, render } from "@solidjs/web";

type Verdict = { ok: boolean; actual: string };

// A plugin system freezes its exported widgets so plugins cannot
// monkey-patch each other.
const PaymentWidget = Object.freeze((props: { label: string }) => <span>{props.label}</span>);

export default function App() {
  const [verdict, setVerdict] = createSignal<Verdict>();

  function attempt(mount: (el: HTMLElement) => () => void) {
    const el = document.createElement("div");
    try {
      const dispose = mount(el);
      const text = el.textContent ?? "";
      dispose();
      return `rendered ${JSON.stringify(text)}`;
    } catch (e: any) {
      return `${e?.name ?? "Error"}: ${e?.message ?? String(e)}`;
    }
  }

  function mountFrozenWidget() {
    const cases = [
      {
        label: "<Dynamic component={PaymentWidget}>",
        result: attempt(el =>
          render(() => <Dynamic component={PaymentWidget} label="Pay now" />, el)
        )
      },
      {
        label: "direct JSX <PaymentWidget />",
        result: attempt(el => render(() => <PaymentWidget label="Pay now" />, el))
      }
    ];
    setVerdict({
      ok: cases.every(c => c.result === 'rendered "Pay now"'),
      actual: cases.map(c => `${c.label}: ${c.result}`).join("\n")
    });
  }

  return (
    <main style={{ "font-family": "system-ui", padding: "16px" }}>
      <h2>Rendering a frozen component function (dev build)</h2>
      <button onClick={mountFrozenWidget}>mount frozen widget</button>
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
            <p>Expected both cases to render "Pay now".</p>
            <pre>{v().actual}</pre>
          </section>
        )}
      </Show>
    </main>
  );
}
```

### Steps to Reproduce the Bug or Issue

1. Run the app with the dev server (the default).
2. Click **mount frozen widget**. Both render attempts throw. On 2.0.0-beta.17 (dev build) the page shows:

```text
FAIL - bug reproduced
<Dynamic component={PaymentWidget}>: TypeError: Cannot add property Symbol(COMPONENT_DEV), object is not extensible
direct JSX <PaymentWidget />: TypeError: Cannot add property Symbol(COMPONENT_DEV), object is not extensible
```

### Expected behavior

Frozen components render in dev exactly as they do in prod:

```text
PASS - bug is fixed
<Dynamic component={PaymentWidget}>: rendered "Pay now"
direct JSX <PaymentWidget />: rendered "Pay now"
```

### Screenshots or Videos

_No response_

### Platform

- OS: macOS
- Browser: Chrome
- Version: 2.0.0-beta.17 (dev build; re-verified at `next` @ `a51cac19`)

### Additional context

Root cause: dev builds unconditionally do `Object.assign(Comp, { [$DEVCOMP]: true })` at `packages/solid/src/client/core.ts:198` (createComponent), `client/component.ts:138` (lazy), and `packages/solid-web/src/index.ts:291` (dynamic) — no extensibility guard, and it mutates the user's function.

Suggested fix direction: guard the `$DEVCOMP` tagging on extensibility (or store the marker off-object), so frozen components render in dev as they do in prod.

Repro test: `packages/solid-web/test/hunt2-dynamic-frozen-component.spec.tsx` (2 failing).

## Does this exist in Solid 1.x?

**Also broken in 1.x** (not a regression): verified 1.9.14 (`hunt-1x-checks/checks/w2-dom-frozen-component.test.tsx`) — dev throws `Cannot add property Symbol(solid-dev-component), object is not extensible`. Long-standing dev/prod divergence.
