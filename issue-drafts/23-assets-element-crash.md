# 2.0.0-beta.17: `<Assets>` / `useAssets()` with element children crashes SSR (`getNextContextId cannot be used under non-hydrating context`)

### Describe the bug

The canonical head-injection pattern — `useAssets(() => <link/>)` or `<Assets><link/></Assets>`, which is exactly how `@solidjs/meta` and most SSR apps manage `<title>`/`<meta>`/`<link>` — crashes on the server:

1. `renderToString` / `renderToStringAsync` throw `Error: getNextContextId cannot be used under non-hydrating context`.
2. `renderToStream` **hangs** (the throw escapes `doShell` via the serializer, so the stream never completes) and then throws.
3. String children are also unusable as a workaround: they get HTML-escaped, so raw `<head>` markup can't be injected either.

This is the pattern every route-level component reaches for to inject its own metadata and preload links, e.g.

```tsx
function ProductRoute(props: { product: Product }) {
  useAssets(() => (
    <>
      <title>{props.product.name}</title>
      <link rel="preload" as="image" href={props.product.heroUrl} />
    </>
  ));

  return <ProductPage product={props.product} />;
}
```

On the server this crashes or hangs before the response can finish, and since strings are escaped, apps cannot safely work around it by returning raw head markup from the asset thunk.

### Your Example Website or App

_StackBlitz link to be added — SSR runs under Node, not a browser: the repro (`src/repro.tsx`) is run with `vite-node` and logs `PASS`/`FAIL` with expected vs actual to the terminal._

The repro server-renders a page containing a support widget that injects its own stylesheet through `useAssets(() => <link/>)`. It uses the sync `renderToString` path, where the error is at least catchable (see Additional context for why the async variants fare worse), and logs PASS if the `<link>` landed in `<head>`, FAIL with the thrown error otherwise.

```tsx
import { renderToString, useAssets } from "@solidjs/web";

function SupportWidget() {
  // The widget injects its own stylesheet into <head> — the canonical
  // useAssets pattern, the same mechanism @solidjs/meta relies on.
  useAssets(() => <link rel="stylesheet" href="/support-widget.css" />);
  return (
    <aside>
      <button>Chat with support</button>
    </aside>
  );
}

const expected =
  'renders the <link> into <head>, e.g. \'<head><link rel="stylesheet" href="/support-widget.css"></head>…\'';

let ok: boolean;
let actual: string;
try {
  const html = renderToString(() => (
    <html>
      <head />
      <body>
        <SupportWidget />
      </body>
    </html>
  ));
  // If we get here the bug is fixed: the link element should have landed in <head>.
  ok = html.includes('href="/support-widget.css"');
  actual = ok
    ? "no crash; link present in head:\n" + html
    : "no crash but link missing from head:\n" + html;
} catch (err) {
  // The bug: renderToString throws while invoking the stored asset thunk.
  ok = false;
  actual = "THREW: " + (err instanceof Error ? err.message : String(err));
}

console.log(ok ? "PASS — bug is fixed" : "FAIL — bug reproduced");
console.log("expected:", expected);
console.log("actual:", actual);
```

The StackBlitz is preconfigured to run `src/repro.tsx` through the server runtime (`vite-node` + `vite-plugin-solid` with `solid: { generate: "ssr", hydratable: true }`) — just read the terminal output.

### Steps to Reproduce the Bug or Issue

1. Open the StackBlitz terminal.
2. Run `npm run repro` — it server-renders an `<html>` document whose body contains the support widget above.
3. On 2.0.0-beta.17 the terminal logs:

```text
FAIL — bug reproduced
expected: renders the <link> into <head>, e.g. '<head><link rel="stylesheet" href="/support-widget.css"></head>…'
actual: THREW: getNextContextId cannot be used under non-hydrating context
```

4. Swapping `renderToString` for `renderToStringAsync` or `renderToStream` is worse: the same throw escapes the seroval serializer as an **unhandled rejection** and the returned promise/stream **hangs forever** (never resolves, never rejects), so it cannot even be caught with try/catch there.

### Expected behavior

The asset element renders into `<head>` — as in Solid 1.x (verified 1.9.14: the `<link>` appears in `<head>` and the body renders):

```text
PASS — bug is fixed
expected: renders the <link> into <head>, e.g. '<head><link rel="stylesheet" href="/support-widget.css"></head>…'
actual: no crash; link present in head
```

### Screenshots or Videos

_No response_

### Platform

- OS: macOS
- Browser: n/a (server render under Node 20)
- Version: 2.0.0-beta.17 (re-verified at `next` @ `a51cac19`)

### Additional context

**Root cause:** asset thunks are stored lazily and invoked in `getAssets()`/`injectAssets()` (dom-expressions `server.js`) during `doShell()` (stream) or at the end of `renderToString()` — **after** `root()` has returned, when `currentOwner` is back to `null`. Rendering the element inside the thunk calls `ssrHydrationKey()` → `getHydrationKey()` → `getNextContextId()`, whose first line is `const o = getOwner(); if (!o) throw` (`packages/solid/src/server/shared.ts:56-57`).

`<Assets>` with element children hits the identical path (it is the same stored-thunk mechanism), and the streaming variant hangs rather than throwing because the error escapes `doShell` via the serializer.

Repro test: `packages/solid-web/test/server/hunt2-assets-element-crash.spec.tsx` (3 failing + a hanging stream variant). 1.x check: `hunt-1x-checks/server-checks/w2-assets-element.test.tsx`.

## Does this exist in Solid 1.x?

**Regression.** Verified against 1.9.14: `useAssets(() => <link/>)` renders the link into `<head>` without crashing.
