/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { describe, expect, test, vi } from "vitest";
import { createEffect, createSignal, For, flush, Show } from "solid-js";
import { Activity, Portal, render } from "../src/index.js";

describe("Activity", () => {
  async function tick() {
    await Promise.resolve();
  }

  test("hides and reveals top-level element children without unmounting them", () => {
    const root = document.createElement("div");
    const [mode, setMode] = createSignal<"hidden" | "visible">("hidden");
    let span!: HTMLSpanElement;

    const dispose = render(
      () => (
        <Activity mode={mode()}>
          <span ref={span}>Cached</span>
        </Activity>
      ),
      root
    );

    expect(span.textContent).toBe("Cached");
    expect(span.style.display).toBe("none");

    setMode("visible");
    flush();
    expect(span.style.display).toBe("");

    setMode("hidden");
    flush();
    expect(span.style.display).toBe("none");

    dispose();
  });

  test("preserves a child element's previous display value", () => {
    const root = document.createElement("div");
    const [hidden, setHidden] = createSignal(true);
    let span!: HTMLSpanElement;

    const dispose = render(
      () => (
        <Activity mode={hidden() ? "hidden" : "visible"}>
          <span ref={span} style={{ display: "inline-block" }}>
            Cached
          </span>
        </Activity>
      ),
      root
    );

    expect(span.style.display).toBe("none");
    setHidden(false);
    flush();
    expect(span.style.display).toBe("inline-block");
    dispose();
  });

  test("keeps inner Activity content hidden while an outer Activity is hidden", () => {
    const root = document.createElement("div");
    const [outerMode, setOuterMode] = createSignal<"hidden" | "visible">("hidden");
    let span!: HTMLSpanElement;

    const dispose = render(
      () => (
        <Activity mode={outerMode()}>
          <Activity mode="visible">
            <span ref={span}>Inner</span>
          </Activity>
        </Activity>
      ),
      root
    );

    expect(span.style.display).toBe("none");
    setOuterMode("visible");
    flush();
    expect(span.style.display).toBe("");
    dispose();
  });

  test("hides portal content inside a hidden Activity", () => {
    const root = document.createElement("div");
    const portalRoot = document.createElement("div");
    const [mode, setMode] = createSignal<"hidden" | "visible">("hidden");
    let portalChild!: HTMLSpanElement;

    document.body.append(root, portalRoot);
    const dispose = render(
      () => (
        <Activity mode={mode()}>
          <div>
            <Portal mount={portalRoot}>
              <span ref={portalChild}>Portal</span>
            </Portal>
          </div>
        </Activity>
      ),
      root
    );

    expect(portalChild.style.display).toBe("none");

    setMode("visible");
    flush();
    expect(portalChild.style.display).toBe("");

    dispose();
    root.remove();
    portalRoot.remove();
  });

  test("revealing an inner Activity inside a portal does not override a hidden outer Activity", () => {
    const root = document.createElement("div");
    const portalRoot = document.createElement("div");
    const [innerMode, setInnerMode] = createSignal<"hidden" | "visible">("hidden");
    let portalChild!: HTMLSpanElement;

    document.body.append(root, portalRoot);
    const dispose = render(
      () => (
        <Activity mode="hidden">
          <div>
            <Portal mount={portalRoot}>
              <Activity mode={innerMode()}>
                <span ref={portalChild}>Nested portal</span>
              </Activity>
            </Portal>
          </div>
        </Activity>
      ),
      root
    );

    expect(portalChild.style.display).toBe("none");
    setInnerMode("visible");
    flush();
    expect(portalChild.style.display).toBe("none");

    dispose();
    root.remove();
    portalRoot.remove();
  });

  test("hides new portals added to an already hidden Activity", () => {
    const root = document.createElement("div");
    const portalRoot = document.createElement("div");
    const [showPortal, setShowPortal] = createSignal(false);
    let localChild!: HTMLDivElement;
    let portalChild!: HTMLSpanElement;

    document.body.append(root, portalRoot);
    const dispose = render(
      () => (
        <Activity mode="hidden">
          <div ref={localChild}>
            <Show when={showPortal()}>
              <Portal mount={portalRoot}>
                <span ref={portalChild}>Later portal</span>
              </Portal>
            </Show>
          </div>
        </Activity>
      ),
      root
    );

    expect(localChild.style.display).toBe("none");
    expect(portalRoot.textContent).toBe("");

    setShowPortal(true);
    flush();

    expect(localChild.style.display).toBe("none");
    expect(portalChild.style.display).toBe("none");

    dispose();
    root.remove();
    portalRoot.remove();
  });

  test("hides new insertions inside an already hidden portal", async () => {
    const root = document.createElement("div");
    const portalRoot = document.createElement("div");
    const [items, setItems] = createSignal(["A"]);

    document.body.append(root, portalRoot);
    const dispose = render(
      () => (
        <Activity mode="hidden">
          <Portal mount={portalRoot}>
            <For each={items()}>{item => <span>{item}</span>}</For>
          </Portal>
        </Activity>
      ),
      root
    );

    expect([...portalRoot.querySelectorAll("span")].map(node => node.style.display)).toEqual([
      "none"
    ]);

    setItems(["A", "B"]);
    flush();
    await tick();

    expect([...portalRoot.querySelectorAll("span")].map(node => node.style.display)).toEqual([
      "none",
      "none"
    ]);

    dispose();
    root.remove();
    portalRoot.remove();
  });

  test("hides new elements inserted while Activity is already hidden", () => {
    const root = document.createElement("div");
    const [show, setShow] = createSignal(false);
    let inserted!: HTMLSpanElement;

    const dispose = render(
      () => (
        <Activity mode="hidden">
          <Show when={show()}>
            <span ref={inserted}>Inserted</span>
          </Show>
        </Activity>
      ),
      root
    );

    setShow(true);
    flush();
    expect(inserted.style.display).toBe("none");
    dispose();
  });

  test("dispose restores elements hidden by Activity", () => {
    const root = document.createElement("div");
    let span!: HTMLSpanElement;

    const dispose = render(
      () => (
        <Activity mode="hidden">
          <span ref={span}>Disposed</span>
        </Activity>
      ),
      root
    );

    expect(span.style.display).toBe("none");
    dispose();
    expect(span.style.display).toBe("");
  });

  test("default and nullish modes are visible", () => {
    const root = document.createElement("div");
    const [mode, setMode] = createSignal<"hidden" | "visible" | null | undefined>(undefined);
    let span!: HTMLSpanElement;

    const dispose = render(
      () => (
        <Activity mode={mode()}>
          <span ref={span}>Visible</span>
        </Activity>
      ),
      root
    );

    expect(span.style.display).toBe("");
    setMode(null);
    flush();
    expect(span.style.display).toBe("");
    setMode("hidden");
    flush();
    expect(span.style.display).toBe("none");

    dispose();
  });

  test("warns when using React's old hidden prop shape", () => {
    const root = document.createElement("div");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const dispose = render(
      () =>
        Activity({
          hidden: true,
          children: <span>Hidden prop</span>
        } as any),
      root
    );

    expect(error).toHaveBeenCalledWith(expect.stringContaining(`mode="hidden"`));
    dispose();
    error.mockRestore();
  });

  // React parity: a hidden Activity is a "soft unmount" — it runs its subtree's
  // user-effect cleanups and stops the effect bodies (so timers/subscriptions
  // don't keep firing behind a hidden pane), while preserving state + DOM, and
  // re-runs the effects on show. (React destroys/recreates passive effects on
  // an Activity's hide/show.)
  describe("React-faithful effect pause", () => {
    test("runs effect cleanups on hide and re-runs effects on show; pauses the body while hidden", () => {
      const root = document.createElement("div");
      const [mode, setMode] = createSignal<"visible" | "hidden">("visible");
      const [n, setN] = createSignal(0);
      const runs: number[] = [];
      const cleanups: number[] = [];

      function Child() {
        createEffect(
          () => n(),
          val => {
            runs.push(val);
            return () => cleanups.push(val);
          }
        );
        return <span>child</span>;
      }

      const dispose = render(
        () => (
          <Activity mode={mode()}>
            <Child />
          </Activity>
        ),
        root
      );
      flush();
      expect(runs).toEqual([0]); // ran once on mount (visible)
      expect(cleanups).toEqual([]);

      // Hide → the effect's cleanup runs (soft unmount).
      setMode("hidden");
      flush();
      expect(cleanups).toEqual([0]);
      expect(runs).toEqual([0]);

      // A source change WHILE hidden does not run the effect body...
      setN(1);
      flush();
      expect(runs).toEqual([0]);

      // ...but the latest value is picked up when it re-runs on show.
      setMode("visible");
      flush();
      expect(runs).toEqual([0, 1]);
      expect(cleanups).toEqual([0]);

      dispose();
    });

    test("preserves signal state and DOM across a hide/show cycle", () => {
      const root = document.createElement("div");
      const [mode, setMode] = createSignal<"visible" | "hidden">("visible");
      let count!: () => number;
      let setCount!: (v: number) => void;
      let span!: HTMLSpanElement;

      function Counter() {
        const [c, setC] = createSignal(0);
        count = c;
        setCount = setC;
        return <span ref={span}>{c()}</span>;
      }

      const dispose = render(
        () => (
          <Activity mode={mode()}>
            <Counter />
          </Activity>
        ),
        root
      );
      flush();
      setCount(5);
      flush();
      expect(span.textContent).toBe("5");

      setMode("hidden");
      flush();
      // State survives; DOM stays current (render effects aren't paused).
      expect(count()).toBe(5);
      setCount(7);
      flush();
      expect(span.textContent).toBe("7");

      setMode("visible");
      flush();
      expect(count()).toBe(7);
      expect(span.textContent).toBe("7");
      dispose();
    });

    test("an effect that mounts inside a hidden Activity does not run until first shown", () => {
      const root = document.createElement("div");
      const [mode, setMode] = createSignal<"visible" | "hidden">("hidden");
      const runs: number[] = [];

      function Child() {
        createEffect(
          () => 0,
          val => {
            runs.push(val);
          }
        );
        return <span>child</span>;
      }

      const dispose = render(
        () => (
          <Activity mode={mode()}>
            <Child />
          </Activity>
        ),
        root
      );
      flush();
      // Mounted hidden → the effect's body never ran (React parity: no effects
      // until first shown).
      expect(runs).toEqual([]);

      setMode("visible");
      flush();
      expect(runs).toEqual([0]);
      dispose();
    });

    test("nested Activity ref-counts: an inner effect stays paused until BOTH ancestors are visible", () => {
      const root = document.createElement("div");
      const [outer, setOuter] = createSignal<"visible" | "hidden">("visible");
      const [inner, setInner] = createSignal<"visible" | "hidden">("visible");
      const [n, setN] = createSignal(0);
      const runs: number[] = [];

      function Leaf() {
        createEffect(
          () => n(),
          val => {
            runs.push(val);
          }
        );
        return <span>leaf</span>;
      }

      const dispose = render(
        () => (
          <Activity mode={outer()}>
            <Activity mode={inner()}>
              <Leaf />
            </Activity>
          </Activity>
        ),
        root
      );
      flush();
      expect(runs).toEqual([0]);

      // Hide both (outer then inner) — effect paused once, cleanup-counted twice.
      setOuter("hidden");
      setInner("hidden");
      flush();

      setN(1);
      flush();
      expect(runs).toEqual([0]); // paused

      // Reveal only the outer — inner is still hidden, so the effect stays paused.
      setOuter("visible");
      flush();
      expect(runs).toEqual([0]);

      // Reveal the inner too — now it resumes and runs with the latest value.
      setInner("visible");
      flush();
      expect(runs).toEqual([0, 1]);
      dispose();
    });
  });
});
