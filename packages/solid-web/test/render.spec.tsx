/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { describe, expect, test } from "vitest";
import { createSignal, flush, onCleanup } from "solid-js";
import { render } from "@solidjs/web";

describe("render() mount and dispose", () => {
  test("dispose removes all inserted DOM from the container", () => {
    const container = document.createElement("div");

    const dispose = render(
      () => (
        <div>
          hello<span>world</span>
        </div>
      ),
      container
    );

    expect(container.innerHTML).toBe("<div>hello<span>world</span></div>");
    dispose();
    expect(container.innerHTML).toBe("");
    expect(container.childNodes.length).toBe(0);
  });

  test("dispose removes multi-root fragments and text nodes", () => {
    const container = document.createElement("div");

    const dispose = render(
      () => (
        <>
          <header>top</header>
          middle
          <footer>bottom</footer>
        </>
      ),
      container
    );

    expect(container.innerHTML).toBe("<header>top</header>middle<footer>bottom</footer>");
    dispose();
    expect(container.childNodes.length).toBe(0);
  });

  test("onCleanup callbacks run on dispose, children before parents", () => {
    const container = document.createElement("div");
    const order: string[] = [];

    const Child = () => {
      onCleanup(() => order.push("child"));
      return <span>child</span>;
    };
    const Parent = () => {
      onCleanup(() => order.push("parent"));
      return (
        <div>
          <Child />
        </div>
      );
    };

    const dispose = render(() => <Parent />, container);

    expect(order).toEqual([]);
    dispose();
    expect(order).toEqual(["child", "parent"]);
  });

  test("render after dispose into the same container works cleanly", () => {
    const container = document.createElement("div");

    const dispose1 = render(() => <p>first</p>, container);
    expect(container.innerHTML).toBe("<p>first</p>");
    dispose1();
    expect(container.childNodes.length).toBe(0);

    const dispose2 = render(() => <p>second</p>, container);
    expect(container.innerHTML).toBe("<p>second</p>");
    expect(container.querySelectorAll("p").length).toBe(1);
    dispose2();
    expect(container.childNodes.length).toBe(0);
  });
});

describe("render() reactive updates", () => {
  test("signal change + flush updates the DOM", () => {
    const container = document.createElement("div");
    const [text, setText] = createSignal("a");

    const dispose = render(() => <div>{text()}</div>, container);

    expect(container.textContent).toBe("a");
    setText("b");
    flush();
    expect(container.textContent).toBe("b");
    setText("c");
    flush();
    expect(container.textContent).toBe("c");
    dispose();
  });

  test("after dispose, further signal changes do not touch the DOM", () => {
    const container = document.createElement("div");
    const [text, setText] = createSignal("before");

    const dispose = render(() => <div>{text()}</div>, container);
    const el = container.firstChild as HTMLDivElement;

    expect(el.textContent).toBe("before");
    setText("updated");
    flush();
    expect(el.textContent).toBe("updated");

    dispose();
    setText("after-dispose");
    flush();
    // The disposed tree's DOM must not react to further updates.
    expect(el.textContent).toBe("updated");
    expect(container.childNodes.length).toBe(0);
  });
});
