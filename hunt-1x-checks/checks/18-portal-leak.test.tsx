// 1.x check for finding 18: does a toggled Portal leak nodes in the mount target?
import { describe, expect, test } from "vitest";
import { createSignal, Show } from "solid-js";
import { render, Portal } from "solid-js/web";

describe("1.x: Portal toggle leaves no residue in the mount target", () => {
  test("mount target is empty after N mount/unmount cycles", () => {
    const target = document.createElement("div");
    document.body.appendChild(target);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const [show, setShow] = createSignal(false);

    const dispose = render(
      () => (
        <Show when={show()}>
          <Portal mount={target}>
            <p>modal</p>
          </Portal>
        </Show>
      ),
      container
    );

    for (let i = 0; i < 5; i++) {
      setShow(true);
      expect(target.querySelector("p")).not.toBeNull();
      setShow(false);
    }
    console.log(
      "[18] target childNodes after 5 toggles:",
      target.childNodes.length,
      [...target.childNodes].map(n => n.nodeName)
    );
    expect(target.childNodes.length).toBe(0);

    dispose();
    target.remove();
    container.remove();
  });
});
