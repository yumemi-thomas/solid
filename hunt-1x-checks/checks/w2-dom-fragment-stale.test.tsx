// 1.x check: DocumentFragment child replaced by text leaves stale children?
import { describe, expect, test } from "vitest";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";

describe("1.x: DocumentFragment in a slot", () => {
  test("replacing the fragment with text removes the fragment's children", () => {
    const [show, setShow] = createSignal(true);
    const frag = document.createDocumentFragment();
    frag.append(document.createElement("i"), document.createElement("i"));
    (frag.childNodes[0] as HTMLElement).textContent = "1";
    (frag.childNodes[1] as HTMLElement).textContent = "2";
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(() => <div>before{show() ? (frag as any) : "x"}after</div>, container);
    console.log("[w2-dom-frag] initial:", container.textContent);
    setShow(false);
    console.log("[w2-dom-frag] after swap:", container.textContent);
    expect(container.textContent).toBe("beforexafter");
    dispose();
    container.remove();
  });
});
