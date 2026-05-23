/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { describe, expect, test, vi } from "vitest";
import { createSignal, flush, Show } from "solid-js";
import { render, Portal } from "@solidjs/web";

describe("Testing a simple Portal", () => {
  let div = document.createElement("div"),
    disposer: () => void;
  const testMount = document.createElement("div");
  const Component = () => <Portal mount={testMount}>Hi</Portal>;

  test("Create portal control flow", () => {
    disposer = render(Component, div);
    expect(div.innerHTML).toBe("");
    expect(testMount.innerHTML).toBe("Hi");
    expect((testMount.firstChild as Text & { _$host: HTMLElement })._$host).toBe(div);
  });

  test("dispose", () => {
    disposer();
    expect(div.innerHTML).toBe("");
  });
});

describe("Testing an SVG Portal", () => {
  let div = document.createElement("div"),
    disposer: () => void;
  const testMount = document.createElement("svg");
  const Component = () => <Portal mount={testMount}>Hi</Portal>;

  test("Create portal control flow", () => {
    disposer = render(Component, div);
    expect(div.innerHTML).toBe("");
    expect(testMount.innerHTML).toBe("Hi");
    expect((testMount.firstChild as Text & { _$host: HTMLElement })._$host).toBe(div);
  });

  test("dispose", () => disposer());
});

describe("Testing Portal delegated event containers", () => {
  test("default body portal from an app root bubbles through the logical tree", () => {
    const root = document.createElement("div");
    const calls: string[] = [];
    let portalButton!: HTMLButtonElement;

    document.body.appendChild(root);
    const dispose = render(
      () => (
        <section onClick={() => calls.push("logical")}>
          <Portal>
            <button ref={portalButton} onClick={() => calls.push("portal")} />
          </Portal>
        </section>
      ),
      root
    );

    portalButton.click();

    expect(calls).toEqual(["portal", "logical"]);
    dispose();
    root.remove();
  });

  test("outside-root portal delegated events bubble through the logical tree", () => {
    const root = document.createElement("div");
    const mount = document.createElement("div");
    const calls: string[] = [];
    let portalButton!: HTMLButtonElement;

    document.body.append(root, mount);
    const dispose = render(
      () => (
        <section onClick={() => calls.push("logical")}>
          <Portal mount={mount}>
            <button ref={portalButton} onClick={() => calls.push("portal")} />
          </Portal>
        </section>
      ),
      root
    );

    portalButton.click();

    expect(calls).toEqual(["portal", "logical"]);
    dispose();
    root.remove();
    mount.remove();
  });

  test("inside-root portal mounts do not install extra delegated listeners", () => {
    const root = document.createElement("div");
    const mount = document.createElement("div");
    const add = vi.spyOn(mount, "addEventListener");
    let portalButton!: HTMLButtonElement;
    let calls = 0;

    root.appendChild(mount);
    document.body.appendChild(root);
    const dispose = render(
      () => (
        <Portal mount={mount}>
          <button ref={portalButton} onClick={() => calls++} />
        </Portal>
      ),
      root
    );

    portalButton.click();

    expect(calls).toBe(1);
    expect(add).not.toHaveBeenCalledWith("click", expect.any(Function));
    dispose();
    add.mockRestore();
    root.remove();
  });
});

describe("Testing Portal mount ref timing", () => {
  test("mounts into an earlier sibling ref", () => {
    const root = document.createElement("div");
    let mount!: HTMLDivElement;
    let portalButton!: HTMLButtonElement;

    document.body.appendChild(root);
    const dispose = render(
      () => (
        <>
          <div ref={mount} />
          <Portal mount={mount}>
            <button ref={portalButton}>Portal button</button>
          </Portal>
        </>
      ),
      root
    );

    expect(root.innerHTML).toBe("<div><button>Portal button</button></div>");
    expect(portalButton.parentNode).toBe(mount);
    expect(portalButton.textContent).toBe("Portal button");
    dispose();
    root.remove();
  });

  test("preserves child ref timing for default body portals", () => {
    const root = document.createElement("div");
    let portalButton!: HTMLButtonElement;

    document.body.appendChild(root);
    const dispose = render(
      () => (
        <Portal>
          <button ref={portalButton}>Ready</button>
        </Portal>
      ),
      root
    );

    expect(portalButton).toBeInstanceOf(HTMLButtonElement);
    expect(portalButton.parentNode).toBe(document.body);
    dispose();
    root.remove();
  });

  test("delegated events bubble through logical tree with an earlier sibling mount ref", () => {
    const root = document.createElement("div");
    const calls: string[] = [];
    let mount!: HTMLDivElement;
    let portalButton!: HTMLButtonElement;

    document.body.appendChild(root);
    const dispose = render(
      () => (
        <section onClick={() => calls.push("logical")}>
          <div ref={mount} />
          <Portal mount={mount}>
            <button ref={portalButton} onClick={() => calls.push("portal")} />
          </Portal>
        </section>
      ),
      root
    );

    portalButton.click();

    expect(calls).toEqual(["portal", "logical"]);
    dispose();
    root.remove();
  });
});

describe("Testing a Portal to the head", () => {
  let div = document.createElement("div"),
    disposer: () => void,
    [s, set] = createSignal("A Meaningful Page Title"),
    [visible, setVisible] = createSignal(true);
  const Component = () => (
    <Show when={visible()}>
      <Portal mount={document.head}>
        <title>{s()}</title>
      </Portal>
    </Show>
  );

  test("Create portal control flow", () => {
    disposer = render(Component, div);
    expect(div.innerHTML).toBe("");
    expect(document.head.innerHTML).toBe("<title>A Meaningful Page Title</title>");
  });

  test("Update title text", () => {
    set("A New Better Page Title");
    flush();
    expect(document.head.innerHTML).toBe("<title>A New Better Page Title</title>");
  });

  test("Hide Portal", () => {
    setVisible(false);
    flush();
    expect(document.head.innerHTML).toBe("");
    setVisible(true);
    flush();
    expect(document.head.innerHTML).toBe("<title>A New Better Page Title</title>");
  });

  test("dispose", async () => {
    expect(document.head.innerHTML).toBe("<title>A New Better Page Title</title>");
    disposer();
    expect(document.head.innerHTML).toBe("");
  });
});

describe("Testing a Portal with Synthetic Events", () => {
  let div = document.createElement("div"),
    disposer: () => void,
    testElem!: HTMLDivElement,
    clicked = false;
  const Component = () => (
    <Portal>
      <div ref={testElem} onClick={e => (clicked = true)} />
    </Portal>
  );

  test("Create portal control flow", () => {
    disposer = render(Component, div);
    expect(div.innerHTML).toBe("");
  });

  test("Test portal element clicked", () => {
    expect(clicked).toBe(false);
    testElem.click();
    expect(clicked).toBe(true);
  });

  test("dispose", () => disposer());
});

describe("Testing a Portal with direct reactive children", () => {
  let div = document.createElement("div"),
    disposer: () => void,
    [count, setCount] = createSignal(1);
  const Component = () => <Portal>{count()}</Portal>;

  test("Create portal control flow", () => {
    disposer = render(Component, div);
    expect(div.innerHTML).toBe("");
    expect(document.body.innerHTML).toBe("1");
  });

  test("Click to trigger reactive update", () => {
    expect(document.body.innerHTML).toBe("1");
    setCount(count() + 1);
    flush();
    expect(document.body.innerHTML).toBe("2");
    setCount(count() + 1);
    flush();
    expect(document.body.innerHTML).toBe("3");
  });

  test("dispose", () => disposer());
});
