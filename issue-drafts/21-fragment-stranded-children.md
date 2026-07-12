# 2.0.0-beta.17: `DocumentFragment` children are stranded in the DOM after a reactive slot update

### Describe the bug

When a reactive slot's value is a `DocumentFragment` and it's later replaced (by text or by another fragment), the fragment's original children are left behind in the DOM. Fragment→fragment updates accumulate all previous children.

`JSX.Element` includes `Node`, and fragments are the standard way third-party/interop code hands over a batch of nodes — a markdown parser, sanitizer output, or a rich-text editor returning a `DocumentFragment` placed in a reactive slot:

```tsx
const preview = createMemo(() => markdownToFragment(markdown()));

return <div class="preview">{preview()}</div>;
```

When the user edits the markdown and the parser returns a new fragment, the old fragment's children remain in the DOM and the new children are appended beside them — the preview shows stale paragraphs mixed with current output, and content duplicates on every reactive swap. (Solid 1.x's `normalizeIncomingArray` expanded fragments into their children so they could be tracked and removed.)

### Your Example Website or App

_StackBlitz link to be added — paste the code below into `src/App.tsx` of the standard SolidJS Vite template (`solid-js@2.0.0-beta.17`, `@solidjs/web@2.0.0-beta.17`, `jsxImportSource: "@solidjs/web"`)._

Two reactive slots each hold a `DocumentFragment` from a stand-in parser; **replace content** swaps one for plain text and the other for a new fragment, then renders a verdict comparing each slot's `textContent` with what it should be: green **PASS** if the old children were removed, red **FAIL** otherwise.

```tsx
import { createSignal, flush, Show } from "solid-js";

type Verdict = { ok: boolean; actual: string };

// Stand-in for an external parser (markdown, sanitizer, rich-text editor)
// that returns its output as a DocumentFragment.
function parseToFragment(a: string, b: string) {
  const frag = document.createDocumentFragment();
  const i1 = document.createElement("i");
  i1.textContent = a;
  const i2 = document.createElement("i");
  i2.textContent = b;
  frag.append(i1, i2);
  return frag;
}

export default function App() {
  const [preview, setPreview] = createSignal<any>(parseToFragment("1", "2"));
  const [comment, setComment] = createSignal<any>(parseToFragment("1", "2"));
  const [verdict, setVerdict] = createSignal<Verdict>();

  let previewEl!: HTMLDivElement;
  let commentEl!: HTMLDivElement;

  function replaceContent() {
    setPreview("x"); // fragment → text
    setComment(parseToFragment("3", "4")); // fragment → fragment
    flush();

    const cases = [
      { label: "fragment -> text", expected: "beforexafter", actual: previewEl.textContent },
      { label: "fragment -> fragment", expected: "before34after", actual: commentEl.textContent }
    ];
    setVerdict({
      ok: cases.every(c => c.actual === c.expected),
      actual: cases
        .map(
          c => `${c.label}: expected ${JSON.stringify(c.expected)}, actual ${JSON.stringify(c.actual)}`
        )
        .join("\n")
    });
  }

  return (
    <main style={{ "font-family": "system-ui", padding: "16px" }}>
      <h2>DocumentFragment in a reactive slot</h2>
      <div ref={previewEl}>
        <span>before</span>
        {preview()}
        <span>after</span>
      </div>
      <div ref={commentEl}>
        <span>before</span>
        {comment()}
        <span>after</span>
      </div>
      <button onClick={replaceContent} style={{ "margin-top": "12px" }}>
        replace content
      </button>
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

1. On load, both slots correctly render the fragment's children between their siblings: `before12after`.
2. Click **replace content** — the first slot's fragment is replaced by the text `"x"`, the second by a new fragment `<i>3</i><i>4</i>`. The old `<i>1</i><i>2</i>` children stay in the DOM in both slots. On 2.0.0-beta.17 the page shows:

```text
FAIL - bug reproduced
fragment -> text: expected "beforexafter", actual "before12xafter"
fragment -> fragment: expected "before34after", actual "before1234after"
```

### Expected behavior

Replacing a fragment child removes the fragment's children instead of leaving them stranded:

```text
PASS - bug is fixed
fragment -> text: expected "beforexafter", actual "beforexafter"
fragment -> fragment: expected "before34after", actual "before34after"
```

### Screenshots or Videos

_No response_

### Platform

- OS: macOS
- Browser: Chrome
- Version: 2.0.0-beta.17 (re-verified at `next` @ `a51cac19`)

### Additional context

Root cause: 2.0's `flatten`/`normalize`/`insertExpression` have no `nodeType === 11` handling. The fragment object is kept as `current`; appending it empties it, so on update `current.parentNode === null` fails every ownership check and its children can never be removed.

Repro test: `packages/solid-web/test/hunt2-fragment-stale-children.spec.tsx` (2 failing + a passing initial-insert control).

## Does this exist in Solid 1.x?

**Also broken in 1.x** for this exact reactive-slot shape (verified 1.9.14, `hunt-1x-checks/checks/w2-dom-fragment-stale.test.tsx`: children stranded the same way). Long-standing gap in fragment handling on the dynamic-child path.
