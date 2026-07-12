/**
 * @jsxImportSource @solidjs/web
 */
// Bug hunt: server-side object `style` and object/array `class` bindings emit a
// LEADING separator when the first entry is skipped.
//
// `ssrStyle` (dom-expressions server.js:823) writes the `;` separator with
// `if (i) result += ";"` — keyed on the loop index, not on whether output
// already exists. When key[0] has an `undefined` value it is skipped, then
// key[1] (i===1, truthy) prepends a stray `;` -> `style=";background:red"`.
//
// `ssrClassName` (server.js:806) has the same shape: `i && (result += " ")`.
// A falsy first class makes the next truthy class start with a leading space
// -> `class=" b c"`.
//
// Both diverge from the client, which builds these strings via CSSOM /
// className without any leading separator, so `renderToString` output (and the
// pre-hydration paint) is wrong.
import { describe, expect, test } from "vitest";
import { renderToString } from "@solidjs/web";

describe("hunt2: object style/class leading separator", () => {
  test("style object with undefined first value has no leading semicolon", () => {
    const html = renderToString(() => (
      <div style={{ color: undefined, background: "red" } as any} />
    ));
    expect(html).toContain('style="background:red"');
    expect(html).not.toContain('style=";');
  });

  test("class object with falsy first key has no leading space", () => {
    const html = renderToString(() => <div class={{ a: false, b: true, c: true } as any} />);
    expect(html).toContain('class="b c"');
    expect(html).not.toContain('class=" ');
  });

  test("control: style/class with truthy first entry are correct", () => {
    const html = renderToString(() => (
      <div class={{ a: true, b: true } as any} style={{ color: "red" } as any} />
    ));
    expect(html).toContain('class="a b"');
    expect(html).toContain('style="color:red"');
  });
});
