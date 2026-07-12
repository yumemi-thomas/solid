// 1.x check for wave-2 SSR findings: leading separators in object style/classList SSR output
import { describe, expect, test } from "vitest";
import { renderToString } from "solid-js/web";

describe("1.x SSR: object style/classList string assembly", () => {
  test("style object with undefined first value has no leading semicolon", () => {
    const html = renderToString(() => (
      <div style={{ color: undefined as any, background: "red" }} />
    ));
    console.log("[w2-sep] style html:", JSON.stringify(html));
    expect(html).not.toContain('style=";');
    expect(html).toContain("background:red");
  });

  test("classList with falsy first key has no leading space", () => {
    const html = renderToString(() => <div classList={{ a: false, b: true, c: true }} />);
    console.log("[w2-sep] class html:", JSON.stringify(html));
    expect(html).not.toContain('class=" ');
    expect(html).toContain("b c");
  });
});
