# 2.0.0-beta.17: `undefined` in `innerHTML`/`textContent`/spread property bindings renders the literal string "undefined"

### Describe the bug

Clearing a property-path binding to `undefined` renders the text `undefined`:

- `<div innerHTML={h()} />` where `h()` → `undefined`
- `<node textContent={t()} />` where `t()` → `undefined`
- spread `{...{ value: undefined }}` on an `<input>` (the input displays `undefined`)

The compiler's own direct `value` binding emits `_v$ ?? ""`, which shows undefined-clear *is* the intended semantic — the other property paths just miss it. Attribute-path bindings are also fine (they remove the attribute on `undefined`).

This shape comes up whenever optional data is cleared while switching between records — a CMS preview clearing optional HTML, text, or form fields:

```tsx
<article innerHTML={selectedPost()?.renderedHtml} />
<textarea textContent={draft()?.notes} />
<input {...fieldProps()} />
```

When `selectedPost()` or `draft()` becomes `undefined`, users see the literal word `undefined` in the preview or input instead of an empty value. This also creates hydration/client parity surprises because direct value bindings already coerce `undefined` to `""`.

### Your Example Website or App

_StackBlitz link to be added — paste the code below into `src/App.tsx` of the standard SolidJS Vite template (`solid-js@2.0.0-beta.17`, `@solidjs/web@2.0.0-beta.17`, `jsxImportSource: "@solidjs/web"`)._

A record preview binds `innerHTML`, `textContent`, and a spread input `value`; **clear selection** sets all three to `undefined` and renders a verdict listing what each binding actually holds: green **PASS** if all three cleared to `""`, red **FAIL** otherwise.

```tsx
import { createSignal, flush, Show } from "solid-js";

type Verdict = { ok: boolean; actual: string };

export default function App() {
  // A CMS-style record preview: every field is optional and cleared on deselect.
  const [html, setHtml] = createSignal<string | undefined>("<b>Hello world</b>");
  const [notes, setNotes] = createSignal<string | undefined>("Draft notes");
  const [fieldProps, setFieldProps] = createSignal<{ value: string | undefined }>({
    value: "Hello world"
  });
  const [verdict, setVerdict] = createSignal<Verdict>();

  let article!: HTMLElement;
  let notesEl!: HTMLParagraphElement;
  let titleEl!: HTMLInputElement;

  function clearSelection() {
    setHtml(undefined);
    setNotes(undefined);
    setFieldProps({ value: undefined });
    flush();

    const cases = [
      ["innerHTML", article.innerHTML],
      ["textContent", notesEl.textContent ?? ""],
      ["spread value", titleEl.value]
    ] as const;
    setVerdict({
      ok: cases.every(([, actual]) => actual === ""),
      actual: cases.map(([label, actual]) => `${label}: ${JSON.stringify(actual)}`).join("\n")
    });
  }

  return (
    <main style={{ "font-family": "system-ui", padding: "16px" }}>
      <h2>Clearing property bindings to undefined</h2>
      <article ref={article} innerHTML={html()} />
      <p ref={notesEl} textContent={notes()} />
      <input ref={titleEl} {...fieldProps()} />
      <div>
        <button onClick={clearSelection} style={{ "margin-top": "12px" }}>
          clear selection
        </button>
      </div>
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
            <p>Expected every cleared binding to be "" (empty).</p>
            <pre>{v().actual}</pre>
          </section>
        )}
      </Show>
    </main>
  );
}
```

### Steps to Reproduce the Bug or Issue

1. On load, the preview shows the record's HTML, notes, and title.
2. Click **clear selection** — every field signal becomes `undefined`, and the literal word `undefined` appears in the article, the notes line, and the input. On 2.0.0-beta.17 the page shows:

```text
FAIL - bug reproduced
innerHTML: "undefined"
textContent: "undefined"
spread value: "undefined"
```

### Expected behavior

`undefined` clears the property (empty), like the guarded direct `value` binding and like attribute bindings (which remove on `undefined`):

```text
PASS - bug is fixed
innerHTML: ""
textContent: ""
spread value: ""
```

### Screenshots or Videos

_No response_

### Platform

- OS: macOS
- Browser: Chrome
- Version: 2.0.0-beta.17 (re-verified at `next` @ `a51cac19`)

### Additional context

Root cause: the compiler emits bare `el.innerHTML = e` / `textNode.data = t` with no guard, and the runtime spread path `assignProp` does `node[prop] = value` unguarded. Distinct from #2737 (spread+innerHTML hydration wiping).

Repro test: `packages/solid-web/test/hunt2-property-binding-undefined.spec.tsx` (3 failing + 2 passing controls: the compiler-guarded direct `value` binding, and attribute removal on `undefined`).

## Does this exist in Solid 1.x?

**Also broken in 1.x** (not a regression): verified 1.9.14 (`hunt-1x-checks/checks/w2-dom-property-undefined.test.tsx`) — `innerHTML={undefined}` renders the text `undefined`. Long-standing inconsistency with the guarded `value` path.
