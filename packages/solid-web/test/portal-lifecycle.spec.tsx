/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";
import { createSignal, flush, Show } from "solid-js";
import { render, Portal } from "@solidjs/web";

describe("Portal marker cleanup on dispose", () => {
  // KNOWN BUG (2.0 audit): Portal strands its endMarker text node on dispose —
  // the render effect cleanup removes [startMarker, endMarker) but never
  // endMarker itself. packages/solid-web/src/index.ts:228-235. Remove .fails
  // when fixed.
  it.fails("removes all nodes (including the end marker) from the mount on dispose", () => {
    const root = document.createElement("div");
    const mount = document.createElement("div");

    document.body.append(root, mount);
    const dispose = render(() => <Portal mount={mount}>Hi</Portal>, root);

    try {
      expect(mount.textContent).toBe("Hi");
      dispose();
      expect(mount.textContent).toBe("");
      expect(mount.childNodes.length).toBe(0); // currently 1: the stray endMarker
    } finally {
      root.remove();
      mount.remove();
    }
  });

  // KNOWN BUG (2.0 audit): each Portal mount/unmount cycle leaks one endMarker
  // text node into the mount element, so toggling a <Show><Portal> 5 times
  // leaves 5 stray nodes. packages/solid-web/src/index.ts:228-235. Remove
  // .fails when fixed.
  it.fails("does not accumulate stray marker nodes when a Show toggles a Portal", () => {
    const root = document.createElement("div");
    const mount = document.createElement("div");
    const [show, setShow] = createSignal(false);

    document.body.append(root, mount);
    const dispose = render(
      () => (
        <Show when={show()}>
          <Portal mount={mount}>content</Portal>
        </Show>
      ),
      root
    );

    try {
      for (let i = 0; i < 5; i++) {
        setShow(true);
        flush();
        expect(mount.textContent).toBe("content");
        setShow(false);
        flush();
        expect(mount.textContent).toBe("");
      }

      expect(mount.childNodes.length).toBe(0); // currently 5: one endMarker per cycle
    } finally {
      dispose();
      root.remove();
      mount.remove();
    }
  });
});

describe("Portal dispose with an externally mutated mount", () => {
  // KNOWN BUG (2.0 audit): Portal dispose throws DOMException NotFoundError if
  // the mount element was externally cleared — cleanup calls m.removeChild
  // unconditionally on nodes that are no longer children.
  // packages/solid-web/src/index.ts:229-234. Remove .fails when fixed.
  it.fails("does not throw when the mount was cleared before dispose", () => {
    const root = document.createElement("div");
    const mount = document.createElement("div");

    document.body.append(root, mount);
    const dispose = render(() => <Portal mount={mount}>Hi</Portal>, root);

    try {
      expect(mount.textContent).toBe("Hi");
      // Simulate a third-party script (or test harness) wiping the mount.
      mount.textContent = "";

      expect(() => dispose()).not.toThrow();
    } finally {
      root.remove();
      mount.remove();
    }
  });
});

describe("Portal effect ownership", () => {
  // KNOWN BUG (2.0 audit): Portal's insert() runs inside a scheduled render
  // effect with no owner, so each mount/update creates ownerless effects that
  // are never disposed (dev warns "[NO_OWNER_EFFECT] Effects created outside a
  // reactive context will never be disposed" once per mount/update).
  // packages/solid-web/src/index.ts:227. Fixed: portal content insert now runs
  // under an owner, so this no longer warns.
  it("does not create ownerless effects for its content insert", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const root = document.createElement("div");
    const mount = document.createElement("div");
    const [txt, setTxt] = createSignal("a");

    document.body.append(root, mount);
    const dispose = render(() => <Portal mount={mount}>{txt()}</Portal>, root);

    try {
      setTxt("b");
      flush();
      setTxt("c");
      flush();
      expect(mount.textContent).toBe("c");

      const noOwnerWarnings = warn.mock.calls.filter(args =>
        String(args[0]).includes("NO_OWNER_EFFECT")
      );
      expect(noOwnerWarnings).toHaveLength(0); // currently 3: initial mount + 2 updates
    } finally {
      warn.mockRestore();
      dispose();
      root.remove();
      mount.remove();
    }
  });
});

describe("Portal direct reactive children into an explicit mount", () => {
  it("updates content correctly across multiple updates", () => {
    const root = document.createElement("div");
    const mount = document.createElement("div");
    const [count, setCount] = createSignal(1);

    document.body.append(root, mount);
    const dispose = render(() => <Portal mount={mount}>{count()}</Portal>, root);

    expect(root.innerHTML).toBe("");
    expect(mount.innerHTML).toBe("1");
    setCount(c => c + 1);
    flush();
    expect(mount.innerHTML).toBe("2");
    setCount(c => c + 1);
    flush();
    expect(mount.innerHTML).toBe("3");

    dispose();
    root.remove();
    mount.remove();
  });
});
