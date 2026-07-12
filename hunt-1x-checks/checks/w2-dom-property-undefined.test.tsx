// 1.x check: undefined in property-path bindings (innerHTML/textContent) renders "undefined"?
import { describe, expect, test } from "vitest";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";

describe("1.x: undefined property bindings", () => {
  test("innerHTML cleared to undefined does not render the text 'undefined'", () => {
    const [h, setH] = createSignal<string | undefined>("<b>hi</b>");
    const container = document.createElement("div");
    document.body.appendChild(container);
    let el!: HTMLDivElement;
    const dispose = render(
      () => <div ref={(e: HTMLDivElement) => (el = e)} innerHTML={h()} />,
      container
    );
    expect(el.textContent).toBe("hi");
    setH(undefined);
    console.log("[w2-dom-undef] innerHTML after undefined:", JSON.stringify(el.innerHTML));
    expect(el.textContent).toBe("");
    dispose();
    container.remove();
  });
});
