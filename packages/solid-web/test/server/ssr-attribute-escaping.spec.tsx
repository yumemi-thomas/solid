/** @jsxImportSource @solidjs/web */
import { describe, expect, test } from "vitest";
import { escape, renderToString, ssrElement } from "@solidjs/web";

describe("SSR attribute escaping", () => {
  const payload = '\"><script>alert(1)</script>';
  const escapedPayload = "&quot;><script>alert(1)</script>";

  test("escapes array-valued JSX attributes after coercion", () => {
    const value = [payload, "tail"];
    const html = renderToString(() => <div title={value as any} />);

    expect(html).toContain(`title="${escapedPayload},tail"`);
    expect(html).not.toContain('\"><script>');
  });

  test("escapes non-string attributes rendered through ssrElement", () => {
    const value = {
      toString() {
        return payload;
      }
    };
    const html = renderToString(() => ssrElement("div", { title: value }, undefined, false));

    expect(html).toContain(`title="${escapedPayload}"`);
    expect(html).not.toContain('\"><script>');
  });

  test("preserves nullish and boolean attribute control values", () => {
    expect(escape(null, true)).toBe(null);
    expect(escape(undefined, true)).toBe(undefined);
    expect(escape(true, true)).toBe(true);
    expect(escape(false, true)).toBe(false);
  });

  test("coerces safe non-string attribute values before escaping", () => {
    expect(escape(42, true)).toBe("42");
    expect(escape(["alpha", "beta"], true)).toBe("alpha,beta");
  });
});
