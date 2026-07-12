# 2.0.0-beta.17: object `style`/`class` SSR output has a leading separator when the first entry is skipped

### Describe the bug

`ssrStyle`/`ssrClassName` key the separator on the loop index rather than on whether output already exists, so a skipped first entry leaves a stray leading separator:

1. `style={{ color: undefined, background: "red" }}` → `style=";background:red"` (leading semicolon)
2. `class={{ a: false, b: true, c: true }}` → `class=" b c"` (leading space)

Browsers tolerate it, but static `renderToString` output and the pre-hydration paint diverge from what the reactive client binding generates — the client builds these values via CSSOM/`className` without any leading separator.

This is easy to hit with any component that builds classes and optional styles from object bindings, the standard design-system shape:

```tsx
<button
  class={{ disabled: props.disabled, primary: props.variant === "primary", compact: true }}
  style={{ color: props.color, background: props.background }}
/>
```

Whenever the first class/style entry is skipped on the server, the emitted HTML starts with a leading space or semicolon. It usually still paints, but snapshots, static HTML comparisons, and pre-hydration output differ from the client-generated value.

### Your Example Website or App

_StackBlitz link to be added — SSR runs under Node, not a browser: the repro (`src/repro.tsx`) is run with `vite-node` and logs `PASS`/`FAIL` with expected vs actual to the terminal._

The repro server-renders a themed card whose first class-object key (`selected`) is falsy and whose first style-object value (`color`, an optional accent) is `undefined` — both should be skipped cleanly. It logs PASS if neither attribute starts with a stray separator, FAIL with the rendered HTML otherwise.

```tsx
import { renderToString } from "@solidjs/web";

function ThemedCard(props: { accent?: string; background: string; selected: boolean }) {
  return (
    <div
      class={{ selected: props.selected, highlighted: true, card: true } as any}
      style={{ color: props.accent, background: props.background } as any}
    >
      Weekly report
    </div>
  );
}

// First class key (`selected`) is falsy, first style value (`color`) is
// undefined — both should be skipped without leaving a leading separator.
const html = renderToString(() => <ThemedCard background="red" selected={false} />);

const styleBad = html.includes('style=";'); // leading semicolon (style objects)
const classBad = html.includes('class=" '); // leading space (class objects)
const ok = !styleBad && !classBad; // fixed => no leading separator

console.log(ok ? "PASS — bug is fixed" : "FAIL — bug reproduced");
console.log('expected: class="highlighted card" and style="background:red"');
console.log("actual:  ", html);
if (styleBad) console.log("!! leading semicolon: style attribute starts with ';'");
if (classBad) console.log("!! leading space: class attribute starts with ' '");
```

The StackBlitz is preconfigured to run `src/repro.tsx` through the server runtime (`vite-node` + `vite-plugin-solid` with `solid: { generate: "ssr", hydratable: true }`) — just read the terminal output.

### Steps to Reproduce the Bug or Issue

1. Open the StackBlitz terminal.
2. Run `npm run repro` — it renders the card with an unset accent color and `selected: false`, so the first entry of each object binding is skipped.
3. On 2.0.0-beta.17 the terminal logs:

```text
FAIL — bug reproduced
expected: class="highlighted card" and style="background:red"
actual:   <div … class=" highlighted card" style=";background:red">Weekly report</div>
!! leading semicolon: style attribute starts with ';'
!! leading space: class attribute starts with ' '
```

### Expected behavior

Separators appear only *between* emitted entries — no leading `;`/space — so the server output matches what the client binding generates:

```text
PASS — bug is fixed
expected: class="highlighted card" and style="background:red"
actual:   <div … class="highlighted card" style="background:red">Weekly report</div>
```

### Screenshots or Videos

_No response_

### Platform

- OS: macOS
- Browser: n/a (server render under Node 20)
- Version: 2.0.0-beta.17 (re-verified at `next` @ `a51cac19`)

### Additional context

**Root cause:** `ssrStyle` does `if (i) result += ";"` (dom-expressions `server.js:835`); `ssrClassName` does `i && (result += " ")` (server.js:815). A skipped first entry (undefined style value / falsy class) makes the next entry (i≥1) prepend a stray separator.

**Suggested fix direction:** key the separator on whether `result` already has output (e.g. `if (result) result += ";"`) instead of on the loop index, in both helpers.

This issue covers both object-binding attributes — the `style` leading-semicolon and the `class` leading-space are the same string-assembly pattern in the two sibling helpers, and the repro exercises both.

Repro test: `packages/solid-web/test/server/hunt2-object-binding-leading-separator.spec.tsx` (2 failing + control). 1.x check: `hunt-1x-checks/server-checks/w2-style-class-separators.test.tsx`.

## Does this exist in Solid 1.x?

**Long-standing — also reproduces in 1.x.** Verified 1.9.14 — same leading `;`/space. Long-standing string-assembly bug in the shared server runtime.
