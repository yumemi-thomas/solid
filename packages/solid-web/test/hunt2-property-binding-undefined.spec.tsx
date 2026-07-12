/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * BUG: property-path bindings render the literal string "undefined" when
 * their value becomes `undefined`, while every attribute-path binding (and
 * the compiler's own direct `value` binding, which emits `_el$.value = v ?? ""`)
 * treats null/undefined as removal/clearing.
 *
 * Affected paths:
 *  - direct `innerHTML={maybe()}` / `textContent={maybe()}` bindings: the
 *    compiler emits a bare `_el$.innerHTML = v` / `textNode.data = v`
 *    (@dom-expressions/babel-plugin-jsx), so `undefined` is stringified.
 *  - spread onto stateful DOM props: `assignProp` does `node[prop] = value`
 *    with no null-guard (@dom-expressions/runtime src/client.js, bundled at
 *    packages/solid-web/dist/dev.js:701-703), so `{...{ value: undefined }}`
 *    puts the text "undefined" into an <input> — even though the direct
 *    `value={undefined}` binding on the same element is guarded (see control).
 */
import { describe, expect, test } from "vitest";
import { createSignal, createRoot, flush } from "solid-js";

describe("undefined in property-path bindings", () => {
  test("innerHTML cleared to undefined must not render the text 'undefined'", () => {
    const [h, setH] = createSignal<string | undefined>("<b>hi</b>");
    let el!: HTMLDivElement;
    const dispose = createRoot(d => {
      <div ref={(e: HTMLDivElement) => (el = e)} innerHTML={h()} />;
      return d;
    });
    flush();
    expect(el.innerHTML).toBe("<b>hi</b>");
    setH(undefined);
    flush();
    expect(el.innerHTML).toBe("");
    dispose();
  });

  test("textContent cleared to undefined must not render the text 'undefined'", () => {
    const [t, setT] = createSignal<string | undefined>("hi");
    let el!: HTMLDivElement;
    const dispose = createRoot(d => {
      <div ref={(e: HTMLDivElement) => (el = e)} textContent={t()} />;
      return d;
    });
    flush();
    expect(el.textContent).toBe("hi");
    setT(undefined);
    flush();
    expect(el.textContent).toBe("");
    dispose();
  });

  test("spread input value cleared to undefined must clear the input", () => {
    const [p, setP] = createSignal<any>({ value: "hello" });
    let el!: HTMLInputElement;
    const dispose = createRoot(d => {
      <input ref={(e: HTMLInputElement) => (el = e)} {...p()} />;
      return d;
    });
    flush();
    expect(el.value).toBe("hello");
    setP({ value: undefined });
    flush();
    expect(el.value).toBe("");
    dispose();
  });

  test("control: direct input value binding is null-guarded by the compiler", () => {
    const [v, setV] = createSignal<string | undefined>("hello");
    let el!: HTMLInputElement;
    const dispose = createRoot(d => {
      <input ref={(e: HTMLInputElement) => (el = e)} value={v()} />;
      return d;
    });
    flush();
    expect(el.value).toBe("hello");
    setV(undefined);
    flush();
    expect(el.value).toBe(""); // compiler emits `_el$.value = v ?? ""` — passes
    dispose();
  });

  test("control: attribute paths remove on undefined", () => {
    const [src, setSrc] = createSignal<string | undefined>("/a.png");
    let el!: HTMLImageElement;
    const dispose = createRoot(d => {
      <img ref={(e: HTMLImageElement) => (el = e)} src={src()} />;
      return d;
    });
    flush();
    setSrc(undefined);
    flush();
    expect(el.hasAttribute("src")).toBe(false); // passes
    dispose();
  });
});
