// 1.x check: dev build rendering a frozen component function
import { describe, expect, test } from "vitest";
import { render, Dynamic } from "solid-js/web";

describe("1.x: frozen component", () => {
  test("<Dynamic> renders a frozen component without throwing", () => {
    const Comp = Object.freeze((props: any) => <span>{props.label}</span>);
    const container = document.createElement("div");
    document.body.appendChild(container);
    let threw: any = null;
    let dispose = () => {};
    try {
      dispose = render(() => <Dynamic component={Comp} label="hi" />, container);
    } catch (e) {
      threw = e;
    }
    console.log("[w2-dom-frozen] threw:", String(threw), "| html:", container.innerHTML);
    expect(threw).toBeNull();
    expect(container.textContent).toBe("hi");
    dispose();
    container.remove();
  });
});
