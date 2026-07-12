/**
 * @jsxImportSource @solidjs/web
 */
// Bug hunt: `<Assets>` / `useAssets()` with JSX ELEMENT children crashes SSR.
//
// The canonical head-injection pattern (used by @solidjs/meta and countless
// apps) is `useAssets(() => <link .../>)` / `<Assets><link/></Assets>`. The
// asset thunks are stored and invoked *lazily* — in `getAssets()` /
// `injectAssets()` during `doShell()` / at the end of `renderToString()` —
// which runs AFTER `root()` has returned and `currentOwner` is back to `null`.
// Rendering the element inside the thunk calls `ssrHydrationKey()` ->
// `getHydrationKey()` -> `sharedConfig.getNextContextId()` which does
// `const o = getOwner(); if (!o) throw new Error("getNextContextId cannot be
// used under non-hydrating context")` (packages/solid/src/server/shared.ts:56-57).
//
// Result: renderToString THROWS; renderToStream never completes (the thrown
// error escapes doShell and the stream hangs). String children are ALSO broken
// (they get HTML-escaped, so raw <head> markup can't be injected either).
import { describe, expect, test } from "vitest";
import { renderToString, renderToStream, Loading, Assets, useAssets } from "@solidjs/web";
import { createMemo } from "solid-js";

function asyncValue<T>(v: T, ms = 5): Promise<T> {
  return new Promise(r => setTimeout(() => r(v), ms));
}

describe("hunt2: Assets/useAssets with element children", () => {
  test("<Assets> with a <link> element renders into <head> (renderToString)", () => {
    const html = renderToString(() => (
      <html>
        <head>
          <title>t</title>
        </head>
        <body>
          <Assets>
            <link rel="stylesheet" href="/a.css" />
          </Assets>
          <div>content</div>
        </body>
      </html>
    ));
    // The stylesheet link must land in the document head.
    expect(html).toContain('href="/a.css"');
    expect(html).toContain("<div>content</div>");
  });

  test("useAssets(() => <link/>) does not crash (renderToString)", () => {
    expect(() =>
      renderToString(() => {
        useAssets(() => <link rel="stylesheet" href="/c.css" />);
        return <div>x</div>;
      })
    ).not.toThrow();
  });

  test("<Assets> with element child completes the stream (renderToStream)", async () => {
    function App() {
      const data = createMemo(async () => asyncValue("late", 15));
      return (
        <html>
          <head>
            <title>t</title>
          </head>
          <body>
            <Loading fallback={<span>L</span>}>
              <Assets>
                <link rel="stylesheet" href="/late.css" />
              </Assets>
              <p>{data()}</p>
            </Loading>
          </body>
        </html>
      );
    }
    const html = await new Promise<string>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("stream never completed (hung)")), 2000);
      renderToStream(() => <App />).then((h: string) => {
        clearTimeout(t);
        resolve(h);
      });
    });
    expect(html).toContain("late");
  });
});
