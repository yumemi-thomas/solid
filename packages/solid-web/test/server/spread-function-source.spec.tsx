/**
 * @jsxImportSource @solidjs/web
 */
import { describe, expect, test } from "vitest";
import { renderToString, Dynamic, mergeProps, ssrElement } from "@solidjs/web";

// Regression: SSR mergeProps dropped props whose source is a function.
// The compiler passes spread sources lazily (`mergeProps({...static}, fn)`);
// the old SSR merger resolved the function for key enumeration only, so the
// per-key getter read `fn[key]` (undefined) and the attribute vanished from
// the HTML. Client rendering and 1.x were unaffected.
describe("SSR spread with function source", () => {
  test("mergeProps resolves function sources for values, not just keys", () => {
    const fn = () => ({ "data-x": "1" });
    const html = renderToString(() => ssrElement("div", mergeProps({ id: "y" }, fn), "x", false));
    expect(html).toContain('data-x="1"');
    expect(html).toContain('id="y"');
  });

  test("object spread source still renders (no regression)", () => {
    const obj = { "data-x": "1" };
    const html = renderToString(() => ssrElement("div", mergeProps({ id: "y" }, obj), "x", false));
    expect(html).toContain('data-x="1"');
    expect(html).toContain('id="y"');
  });

  test("JSX spread of a function call result alongside a static attribute", () => {
    const html = renderToString(() => <div id="y" {...(() => ({ "data-x": "1" }))()} />);
    expect(html).toContain('data-x="1"');
    expect(html).toContain('id="y"');
  });

  test("Dynamic routes spreads through mergeProps", () => {
    const props = { "data-x": "1", id: "y" };
    const html = renderToString(() => <Dynamic component="div" {...props} />);
    expect(html).toContain('data-x="1"');
    expect(html).toContain('id="y"');
  });

  test("later function source overrides earlier static prop", () => {
    const fn = () => ({ id: "override" });
    const html = renderToString(() => ssrElement("div", mergeProps({ id: "y" }, fn), "x", false));
    expect(html).toContain('id="override"');
    expect(html).not.toContain('id="y"');
  });
});
