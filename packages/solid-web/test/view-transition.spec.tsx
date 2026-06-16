/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createMemo, createSignal, flush, For, Loading, Reveal, Show } from "solid-js";
import {
  addTransitionType,
  render,
  setAttribute,
  startGestureTransition,
  startViewTransition,
  ViewTransition
} from "../src/index.js";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(r => (resolve = r));
  return { promise, resolve };
}

async function tick(times = 1) {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

// React parity: enter / exit / update / share fire only when the DOM change
// commits inside a transition. Drive the mount / unmount / mutation through
// `startViewTransition` so `activeViewTransition` is set during the flush, then
// let the scope's flush and the deferred lifecycle microtasks settle.
async function inTransition(fn: () => unknown, ticks = 4) {
  startViewTransition(fn);
  await tick(ticks);
}

function viewTransitionClass(element: HTMLElement) {
  return ((element.style as CSSStyleDeclaration & { viewTransitionClass?: string })
    .viewTransitionClass ?? "") as string;
}

describe("ViewTransition", () => {
  let originalStartViewTransition: unknown;
  let originalGBCR: typeof Element.prototype.getBoundingClientRect;
  let transitions: Array<{ ready: Promise<void>; finished: Promise<void>; skipTransition(): void }>;

  beforeEach(() => {
    originalStartViewTransition = (document as any).startViewTransition;
    transitions = [];
    (document as any).startViewTransition = vi.fn((update: (() => void) | { update(): void }) => {
      if (typeof update === "function") update();
      else update.update();
      const transition = {
        ready: Promise.resolve(),
        finished: Promise.resolve(),
        skipTransition: vi.fn()
      };
      transitions.push(transition);
      return transition;
    });
    // jsdom has no layout engine (every rect is 0×0), but `<ViewTransition>`
    // update detection is geometry-driven. Derive a deterministic rect from the
    // element's text length so a *content* change registers as a geometry
    // change, while a class/style-only change (same text) does not — exactly the
    // distinction React's `hasInstanceChanged` makes. Positioned at the origin
    // so the viewport guard always counts it as in-view.
    originalGBCR = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function (this: Element) {
      const width = (this.textContent ?? "").length * 8;
      return {
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: width,
        bottom: 16,
        width,
        height: 16,
        toJSON() {}
      } as DOMRect;
    };
  });

  afterEach(() => {
    Element.prototype.getBoundingClientRect = originalGBCR;
    if (originalStartViewTransition) {
      (document as any).startViewTransition = originalStartViewTransition;
    } else {
      delete (document as any).startViewTransition;
    }
  });

  test("applies a transition name and fires onEnter", async () => {
    const root = document.createElement("div");
    const onEnter = vi.fn();
    const [show, setShow] = createSignal(false);
    let span!: HTMLSpanElement;

    const dispose = render(
      () => (
        <Show when={show()}>
          <ViewTransition name="hero" onEnter={onEnter}>
            <span ref={span}>Hero</span>
          </ViewTransition>
        </Show>
      ),
      root
    );

    await tick();
    expect(onEnter).not.toHaveBeenCalled();

    await inTransition(() => setShow(true));

    expect((document as any).startViewTransition).toHaveBeenCalledTimes(1);
    expect(onEnter).toHaveBeenCalledTimes(1);
    expect(onEnter.mock.calls[0][0]).toMatchObject({ name: "hero", nodes: [span] });
    expect(span.style.viewTransitionName).toBe("hero");
    dispose();
  });

  test("auto-generates a transition name when name is omitted", async () => {
    const root = document.createElement("div");
    let span!: HTMLSpanElement;

    const dispose = render(
      () => (
        <ViewTransition>
          <span ref={span}>Auto</span>
        </ViewTransition>
      ),
      root
    );

    await tick();
    expect(span.style.viewTransitionName).toMatch(/^solid-vt-/);
    dispose();
  });

  test("warns for duplicate explicit names mounted at the same time", async () => {
    const root = document.createElement("div");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const dispose = render(
      () => (
        <>
          <ViewTransition name="duplicate">
            <span>One</span>
          </ViewTransition>
          <ViewTransition name="duplicate">
            <span>Two</span>
          </ViewTransition>
        </>
      ),
      root
    );

    await tick();

    expect(error).toHaveBeenCalledWith(expect.stringContaining(`name="duplicate"`));
    dispose();
    error.mockRestore();
  });

  test("applies transition names to multiple top-level elements", async () => {
    const root = document.createElement("div");
    let first!: HTMLSpanElement;
    let second!: HTMLSpanElement;
    const onEnter = vi.fn();
    const [show, setShow] = createSignal(false);

    const dispose = render(
      () => (
        <Show when={show()}>
          <ViewTransition name="pair" onEnter={onEnter}>
            <span ref={first}>One</span>
            <span ref={second}>Two</span>
          </ViewTransition>
        </Show>
      ),
      root
    );

    await tick();
    await inTransition(() => setShow(true));

    expect(first.style.viewTransitionName).toBe("pair");
    expect(second.style.viewTransitionName).toBe("pair_1");
    expect(onEnter.mock.calls[0][0]).toMatchObject({ name: "pair", nodes: [first, second] });
    dispose();
  });

  test("provides pseudo-element handles to transition callbacks", async () => {
    const root = document.createElement("div");
    const animate = vi.fn(() => ({ cancel() {}, finished: Promise.resolve() }));
    const originalAnimate = document.documentElement.animate;
    document.documentElement.animate =
      animate as unknown as typeof document.documentElement.animate;
    const onEnter = vi.fn(instance => {
      instance.old.animate([{ opacity: 0 }], { duration: 100 });
      instance.new.animate([{ opacity: 1 }], 200);
    });
    const [show, setShow] = createSignal(false);

    const dispose = render(
      () => (
        <Show when={show()}>
          <ViewTransition name="hero" onEnter={onEnter}>
            <span>Hero</span>
          </ViewTransition>
        </Show>
      ),
      root
    );

    await tick();
    await inTransition(() => setShow(true));

    expect(onEnter).toHaveBeenCalledTimes(1);
    expect(onEnter.mock.calls[0][0]).toMatchObject({
      name: "hero",
      group: expect.objectContaining({
        animate: expect.any(Function),
        getAnimations: expect.any(Function),
        getComputedStyle: expect.any(Function)
      }),
      imagePair: expect.any(Object),
      old: expect.any(Object),
      new: expect.any(Object)
    });
    const animateCall = animate.mock.calls[0] as unknown as [unknown, KeyframeAnimationOptions];
    expect(animateCall[1]).toMatchObject({
      duration: 100,
      pseudoElement: "::view-transition-old(hero)"
    });
    const durationCall = animate.mock.calls[1] as unknown as [unknown, KeyframeAnimationOptions];
    expect(durationCall[1]).toMatchObject({
      duration: 200,
      pseudoElement: "::view-transition-new(hero)"
    });
    dispose();
    document.documentElement.animate = originalAnimate;
  });

  test("falls back when document.startViewTransition is unavailable", async () => {
    const root = document.createElement("div");
    const onEnter = vi.fn();
    const [show, setShow] = createSignal(false);
    let span!: HTMLSpanElement;
    delete (document as any).startViewTransition;

    const dispose = render(
      () => (
        <Show when={show()}>
          <ViewTransition name="fallback" onEnter={onEnter}>
            <span ref={span}>Fallback</span>
          </ViewTransition>
        </Show>
      ),
      root
    );

    await tick();
    // No browser API, but `startViewTransition` still runs the scope and sets
    // the active-transition scope synchronously, so enter still fires.
    await inTransition(() => setShow(true));

    expect(onEnter).toHaveBeenCalledTimes(1);
    expect(span.style.viewTransitionName).toBe("fallback");
    dispose();
  });

  test("fires onUpdate when content mutates inside the transition", async () => {
    const root = document.createElement("div");
    const [text, setText] = createSignal("Short");
    const onUpdate = vi.fn();

    const dispose = render(
      () => (
        <ViewTransition name="card" onUpdate={onUpdate}>
          <span>{text()}</span>
        </ViewTransition>
      ),
      root
    );

    await Promise.resolve();
    await inTransition(() => setText("Much longer content"));

    expect(onUpdate).toHaveBeenCalledTimes(1);
    dispose();
  });

  test("does not treat internal transition style writes as updates", async () => {
    const root = document.createElement("div");
    const onUpdate = vi.fn();

    const dispose = render(
      () => (
        <ViewTransition name="stable" onUpdate={onUpdate}>
          <span>Stable</span>
        </ViewTransition>
      ),
      root
    );

    await tick(2);

    expect(onUpdate).not.toHaveBeenCalled();
    dispose();
  });

  // Regression: a browser extension / third-party script (password managers,
  // Grammarly, form fillers, …) repeatedly stamping data-*/aria-* attributes
  // onto observed nodes must not be treated as content changes — otherwise the
  // observer fires an "update" transition whose settle frees the script to stamp
  // again, looping forever. Only childList/characterData are real content.
  test("ignores third-party attribute mutations (data-*/aria-*)", async () => {
    const root = document.createElement("div");
    const onUpdate = vi.fn();
    let span!: HTMLSpanElement;

    const dispose = render(
      () => (
        <ViewTransition name="resilient" onUpdate={onUpdate}>
          <span ref={span}>Stable</span>
        </ViewTransition>
      ),
      root
    );

    await tick(2);

    span.setAttribute("data-extension-id", "abc");
    span.setAttribute("aria-busy", "true");
    span.setAttribute("data-extension-id", "def");
    await tick(3);

    expect(onUpdate).not.toHaveBeenCalled();
    dispose();
  });

  // React parity (`hasInstanceChanged`): update detection is geometry-driven, so
  // a reactive change that leaves the boundary's size/position untouched —
  // toggling a class, flipping a non-layout style, setting a data attribute —
  // does NOT fire `update`, even inside a transition. (Previously Solid fired on
  // any reactive DOM write; React cancels a no-geometry-change update.)
  test("does not fire onUpdate when a reactive change leaves geometry unchanged", async () => {
    const root = document.createElement("div");
    const onUpdate = vi.fn();
    const [done, setDone] = createSignal(false);
    let span!: HTMLSpanElement;

    const dispose = render(
      () => (
        <ViewTransition name="no-geo" onUpdate={onUpdate}>
          {/* text content is constant, so the mocked rect width never changes */}
          <span ref={span} class={{ row: true, done: done() }}>
            Constant
          </span>
        </ViewTransition>
      ),
      root
    );

    await tick(2);

    await inTransition(() => {
      setDone(true); // class toggle — no layout change
      setAttribute(span, "data-state", "open"); // attribute — no layout change
    });

    expect(onUpdate).not.toHaveBeenCalled();
    dispose();
  });

  // A reactive change that DOES alter the boundary's geometry fires `update`,
  // regardless of which kind of DOM write produced it (the geometry model is
  // write-agnostic — no more per-mutation-type detection).
  test("fires onUpdate when a reactive change resizes the boundary", async () => {
    const root = document.createElement("div");
    const onUpdate = vi.fn();
    const [label, setLabel] = createSignal("hi");

    const dispose = render(
      () => (
        <ViewTransition name="resize" onUpdate={onUpdate}>
          <span>{label()}</span>
        </ViewTransition>
      ),
      root
    );

    await tick(2);

    await inTransition(() => setLabel("a considerably wider label"));

    expect(onUpdate).toHaveBeenCalledTimes(1);
    dispose();
  });

  // Regression: the re-entrancy guard (`updateInFlight`) must not start a second
  // update event for a boundary while the previous one is still in flight. A
  // geometry change during the pending window is dropped; once it settles, a
  // later geometry change animates again.
  test("does not re-fire onUpdate for a boundary while its update is in flight", async () => {
    const root = document.createElement("div");
    const [text, setText] = createSignal("one");
    const onUpdate = vi.fn();
    // Each transition gets its own resolver so we can settle them individually.
    const settles: Array<() => void> = [];
    (document as any).startViewTransition = vi.fn((update: (() => void) | { update(): void }) => {
      if (typeof update === "function") update();
      else update.update();
      const d = deferred();
      settles.push(d.resolve);
      return { ready: d.promise, finished: d.promise, skipTransition() {} };
    });

    const dispose = render(
      () => (
        <ViewTransition name="reentrancy" onUpdate={onUpdate}>
          <span>{text()}</span>
        </ViewTransition>
      ),
      root
    );

    await tick();
    // Mount happened outside a transition (no enter), so nothing is pending.
    expect(onUpdate).not.toHaveBeenCalled();

    // First geometry change, inside a transition, fires onUpdate; its backing
    // transition stays pending (its `finished` is the deferred above). Each step
    // uses a distinct text length so the mocked rect width genuinely changes.
    await inTransition(() => setText("two is wider"), 3); // len 12
    expect(onUpdate).toHaveBeenCalledTimes(1);

    // Second geometry change while the update is still in flight is dropped by
    // the re-entrancy guard (`updateInFlight`).
    await inTransition(() => setText("three is much much wider"), 3); // len 24
    expect(onUpdate).toHaveBeenCalledTimes(1);

    // Once the in-flight update transition settles, a later geometry change
    // animates again. (Settle every opened transition so the guard clears.)
    settles.splice(0).forEach(resolve => resolve());
    await tick(3);
    await inTransition(() => setText("four is the widest label of them all"), 3); // len 36
    expect(onUpdate).toHaveBeenCalledTimes(2);
    dispose();
  });

  // Regression: a superseded transition skips, rejecting ready/finished with
  // AbortError. That's expected, so ignoring the return value must be safe —
  // callers shouldn't have to .catch() it to avoid an "Uncaught (in promise)".
  // Callers that DO await ready/finished still observe the rejection.
  test("a skipped transition stays safe to ignore yet still rejects for awaiters", async () => {
    const abort = Object.assign(new Error("Transition was skipped"), { name: "AbortError" });
    const rejected = Promise.reject(abort);
    rejected.catch(() => {}); // keep the browser-side promise from leaking in the harness
    (document as any).startViewTransition = vi.fn((update: (() => void) | { update(): void }) => {
      if (typeof update === "function") update();
      else update.update();
      return { ready: rejected, finished: rejected, skipTransition() {} };
    });

    // Ignoring the return value must not throw (core attaches its own catch so
    // there's no unhandled rejection); a caller that awaits still sees it reject.
    let transition!: ReturnType<typeof startViewTransition>;
    expect(() => {
      transition = startViewTransition(() => {});
    }).not.toThrow();

    await expect(transition.ready).rejects.toMatchObject({ name: "AbortError" });
    await expect(transition.finished).rejects.toMatchObject({ name: "AbortError" });
    await tick(2);
  });

  test("fires onExit when the transition unmounts", async () => {
    const root = document.createElement("div");
    const [show, setShow] = createSignal(true);
    const onExit = vi.fn();

    const dispose = render(
      () => (
        <Show when={show()}>
          <ViewTransition name="toast" onExit={onExit}>
            <span>Toast</span>
          </ViewTransition>
        </Show>
      ),
      root
    );

    await tick();
    await inTransition(() => setShow(false));

    expect(onExit).toHaveBeenCalledTimes(1);
    dispose();
  });

  test("clears transition names after unmount", async () => {
    const root = document.createElement("div");
    const [show, setShow] = createSignal(true);
    let span!: HTMLSpanElement;

    const dispose = render(
      () => (
        <Show when={show()}>
          <ViewTransition name="clear-name">
            <span ref={span}>Clear</span>
          </ViewTransition>
        </Show>
      ),
      root
    );

    await tick();
    expect(span.style.viewTransitionName).toBe("clear-name");

    setShow(false);
    flush();
    await tick();

    expect(span.style.viewTransitionName).toBe("");
    dispose();
  });

  test("pairs same-name replacements as share instead of exit plus enter", async () => {
    const root = document.createElement("div");
    const [page, setPage] = createSignal<"a" | "b">("a");
    const onShareA = vi.fn();
    const onExitA = vi.fn();
    const onEnterB = vi.fn();

    const dispose = render(
      () => (
        <Show
          when={page() === "a"}
          keyed
          fallback={
            <ViewTransition name="hero" onEnter={onEnterB}>
              <span>Page B</span>
            </ViewTransition>
          }
        >
          <ViewTransition name="hero" onShare={onShareA} onExit={onExitA}>
            <span>Page A</span>
          </ViewTransition>
        </Show>
      ),
      root
    );

    await tick();
    onShareA.mockClear();
    onExitA.mockClear();
    onEnterB.mockClear();

    await inTransition(() => setPage("b"));

    expect(onShareA).toHaveBeenCalledTimes(1);
    expect(onExitA).not.toHaveBeenCalled();
    expect(onEnterB).not.toHaveBeenCalled();
    dispose();
  });

  // Nested same-name replacement. React pairs each named boundary independently
  // (a parent share does NOT subsume nested ones — see commitDeletedPairView-
  // Transitions, which recurses into a deleted subtree even after the parent
  // paired), so both the outer and inner boundaries fire `share`.
  test("pairs nested same-name replacements as independent shares", async () => {
    const root = document.createElement("div");
    const [page, setPage] = createSignal<"a" | "b">("a");
    const outerShare = vi.fn();
    const innerShare = vi.fn();
    const outerExit = vi.fn();
    const innerExit = vi.fn();

    const Card = (props: { label: string }) => (
      <ViewTransition name="nested-outer" onShare={outerShare} onExit={outerExit}>
        <div>
          <ViewTransition name="nested-inner" onShare={innerShare} onExit={innerExit}>
            <span>{props.label}</span>
          </ViewTransition>
        </div>
      </ViewTransition>
    );

    const dispose = render(
      () => (
        <Show when={page() === "a"} keyed fallback={<Card label="B" />}>
          <Card label="A" />
        </Show>
      ),
      root
    );

    await tick(2);

    await inTransition(() => setPage("b"));

    expect(outerShare).toHaveBeenCalledTimes(1);
    expect(innerShare).toHaveBeenCalledTimes(1);
    expect(outerExit).not.toHaveBeenCalled();
    expect(innerExit).not.toHaveBeenCalled();
    dispose();
  });

  // Nested removal with no replacement. React fires `onExit` only for the
  // outermost deleted boundary; nested unmatched boundaries are subsumed — their
  // animation rides under the ancestor's exit and they fire no individual
  // `onExit`. Exits are batched one microtask so the ancestor relationship is
  // known before any event fires.
  test("subsumes nested exits under the outermost exit", async () => {
    const root = document.createElement("div");
    const [show, setShow] = createSignal(true);
    const outerExit = vi.fn();
    const innerExit = vi.fn();

    const dispose = render(
      () => (
        <Show when={show()}>
          <ViewTransition name="exit-outer" onExit={outerExit}>
            <div>
              <ViewTransition name="exit-inner" onExit={innerExit}>
                <span>Leaf</span>
              </ViewTransition>
            </div>
          </ViewTransition>
        </Show>
      ),
      root
    );

    await tick(2);

    await inTransition(() => setShow(false));

    expect(outerExit).toHaveBeenCalledTimes(1);
    expect(innerExit).not.toHaveBeenCalled();
    dispose();
  });

  // Two unrelated (non-nested) boundaries removed in the same flush both exit —
  // the ancestor-subsumption check must not collapse siblings.
  test("fires separate exits for unrelated boundaries removed together", async () => {
    const root = document.createElement("div");
    const [show, setShow] = createSignal(true);
    const exitOne = vi.fn();
    const exitTwo = vi.fn();

    const dispose = render(
      () => (
        <Show when={show()}>
          <div>
            <ViewTransition name="sib-one" onExit={exitOne}>
              <span>One</span>
            </ViewTransition>
            <ViewTransition name="sib-two" onExit={exitTwo}>
              <span>Two</span>
            </ViewTransition>
          </div>
        </Show>
      ),
      root
    );

    await tick(2);

    await inTransition(() => setShow(false));

    expect(exitOne).toHaveBeenCalledTimes(1);
    expect(exitTwo).toHaveBeenCalledTimes(1);
    dispose();
  });

  test("applies event classes while the browser transition is pending", async () => {
    const root = document.createElement("div");
    const pending = deferred();
    const [show, setShow] = createSignal(false);
    let span!: HTMLSpanElement;
    (document as any).startViewTransition = vi.fn((update: () => void) => {
      update();
      return { ready: pending.promise, finished: pending.promise, skipTransition() {} };
    });

    const dispose = render(
      () => (
        <Show when={show()}>
          <ViewTransition name="classy" default="default-class" enter="enter-class">
            <span ref={span}>Classy</span>
          </ViewTransition>
        </Show>
      ),
      root
    );

    await tick();
    // Mount inside a transition so enter fires; assert mid-flight (still pending).
    startViewTransition(() => setShow(true));
    await tick(2);

    expect(span.classList.contains("enter-class")).toBe(false);
    expect(viewTransitionClass(span)).toBe("enter-class");

    pending.resolve();
    await tick(3);

    expect(viewTransitionClass(span)).toBe("");
    dispose();
  });

  test("selects transition classes by active transition type", async () => {
    const root = document.createElement("div");
    const pending = deferred();
    const onEnter = vi.fn();
    const [show, setShow] = createSignal(false);
    let span!: HTMLSpanElement;
    (document as any).startViewTransition = vi.fn((update: () => void) => {
      update();
      return { ready: pending.promise, finished: pending.promise, skipTransition() {} };
    });

    const dispose = render(
      () => (
        <Show when={show()}>
          <ViewTransition
            name="typed-class"
            enter={{ default: "default-enter", route: "route-enter", modal: "modal-enter" }}
            onEnter={onEnter}
          >
            <span ref={span}>Typed</span>
          </ViewTransition>
        </Show>
      ),
      root
    );

    await tick();
    // Types added inside the scope flow into the transition (and don't leak via
    // the addTransitionType auto-clear microtask, which only arms when the list
    // starts null — outside a scope).
    startViewTransition(() => {
      addTransitionType("route");
      addTransitionType("modal");
      setShow(true);
    });
    await tick(2);

    expect(span.classList.contains("route-enter")).toBe(false);
    expect(viewTransitionClass(span)).toBe("route-enter modal-enter");
    expect(onEnter.mock.calls[0][1]).toEqual(["route", "modal"]);

    pending.resolve();
    await tick(3);
    dispose();
  });

  test("passes scoped transition types to the native View Transition API", async () => {
    const nativeTypes = new Set<string>();
    let nativeOptions: { update(): unknown; types?: string[] } | undefined;
    (document as any).startViewTransition = vi.fn(
      (update: (() => unknown) | { update(): unknown; types?: string[] }) => {
        if (typeof update === "function") update();
        else {
          nativeOptions = update;
          update.types?.forEach(type => nativeTypes.add(type));
          update.update();
        }
        return {
          ready: Promise.resolve(),
          finished: Promise.resolve(),
          updateCallbackDone: Promise.resolve(),
          types: { add: (type: string) => nativeTypes.add(type) },
          skipTransition() {}
        };
      }
    );

    const transition = startViewTransition(
      () => {
        addTransitionType("modal");
      },
      { types: ["route"] }
    );

    await transition.updateCallbackDone;

    expect(nativeOptions?.types).toEqual(["route"]);
    expect([...nativeTypes]).toEqual(["route", "modal"]);
  });

  test("transition class map none wins over other matching types", async () => {
    const root = document.createElement("div");
    const pending = deferred();
    const [show, setShow] = createSignal(false);
    let span!: HTMLSpanElement;
    (document as any).startViewTransition = vi.fn((update: () => void) => {
      update();
      return { ready: pending.promise, finished: pending.promise, skipTransition() {} };
    });

    const dispose = render(
      () => (
        <Show when={show()}>
          <ViewTransition
            name="none-wins"
            enter={{ default: "default-enter", route: "route-enter", blocked: "none" }}
          >
            <span ref={span}>None wins</span>
          </ViewTransition>
        </Show>
      ),
      root
    );

    await tick();
    startViewTransition(() => {
      addTransitionType("route");
      addTransitionType("blocked");
      setShow(true);
    });
    await tick(2);

    // `none` in the matched `blocked` type suppresses the class entirely.
    expect(viewTransitionClass(span)).toBe("");
    pending.resolve();
    await tick(3);
    dispose();
  });

  test("uses default transition class when an event class is not provided", async () => {
    const root = document.createElement("div");
    const pending = deferred();
    let span!: HTMLSpanElement;
    (document as any).startViewTransition = vi.fn((update: () => void) => {
      update();
      return { ready: pending.promise, finished: pending.promise, skipTransition() {} };
    });

    const [show, setShow] = createSignal(false);
    const dispose = render(
      () => (
        <Show when={show()}>
          <ViewTransition name="default-class" default="shared-class">
            <span ref={span}>Default class</span>
          </ViewTransition>
        </Show>
      ),
      root
    );

    await tick();
    startViewTransition(() => setShow(true));
    await tick(2);

    expect(viewTransitionClass(span)).toBe("shared-class");
    pending.resolve();
    await tick(3);
    expect(viewTransitionClass(span)).toBe("");
    dispose();
  });

  test("does not add classes for auto or none transition class values", async () => {
    const root = document.createElement("div");
    const [show, setShow] = createSignal(false);
    let first!: HTMLSpanElement;
    let second!: HTMLSpanElement;

    const dispose = render(
      () => (
        <Show when={show()}>
          <ViewTransition name="auto-class" enter="auto">
            <span ref={first}>Auto</span>
          </ViewTransition>
          <ViewTransition name="none-class" enter="none">
            <span ref={second}>None</span>
          </ViewTransition>
        </Show>
      ),
      root
    );

    await tick();
    await inTransition(() => setShow(true));

    expect(viewTransitionClass(first)).toBe("");
    expect(viewTransitionClass(second)).toBe("");
    dispose();
  });

  test("runs callback cleanup after the transition finishes", async () => {
    const root = document.createElement("div");
    const pending = deferred();
    const cleanup = vi.fn();
    const [show, setShow] = createSignal(false);
    (document as any).startViewTransition = vi.fn((update: () => void) => {
      update();
      return { ready: pending.promise, finished: pending.promise, skipTransition() {} };
    });

    const dispose = render(
      () => (
        <Show when={show()}>
          <ViewTransition name="cleanup" onEnter={() => cleanup}>
            <span>Cleanup</span>
          </ViewTransition>
        </Show>
      ),
      root
    );

    await tick();
    startViewTransition(() => setShow(true));
    await tick(2);
    expect(cleanup).not.toHaveBeenCalled();

    pending.resolve();
    await tick(3);

    expect(cleanup).toHaveBeenCalledTimes(1);
    dispose();
  });

  test("runs async Loading updates inside the native update callback", async () => {
    const root = document.createElement("div");
    const resolvers: Record<string, (value: string) => void> = {};
    let setId!: (value: string) => void;
    let capturedText = "";

    (document as any).startViewTransition = vi.fn((update: () => unknown) => {
      const updateCallbackDone = Promise.resolve(update()).then(() => {
        capturedText = root.textContent!;
      });
      return {
        ready: updateCallbackDone,
        finished: updateCallbackDone,
        updateCallbackDone,
        skipTransition() {}
      };
    });

    const dispose = render(() => {
      const [id, _setId] = createSignal("a");
      setId = _setId;
      const data = createMemo(async () => {
        const current = id();
        return await new Promise<string>(resolve => (resolvers[current] = resolve));
      });

      return (
        <ViewTransition name="async-loading">
          <Loading fallback="loading" on={id()}>
            {data()}
          </Loading>
        </ViewTransition>
      );
    }, root);

    flush();
    resolvers.a("data-a");
    await tick(2);
    flush();
    expect(root.textContent).toBe("data-a");

    vi.mocked((document as any).startViewTransition).mockClear();
    const transition = startViewTransition(async () => {
      addTransitionType("route");
      setId("b");
      flush();
      expect(root.textContent).toBe("loading");

      resolvers.b("data-b");
      await tick(2);
      flush();
      expect(root.textContent).toBe("data-b");

      return root.textContent!;
    });

    expect((document as any).startViewTransition).toHaveBeenCalledTimes(1);
    await expect(transition.result).resolves.toBe("data-b");
    await transition.updateCallbackDone;
    expect(capturedText).toBe("data-b");
    dispose();
  });

  test("runs Reveal groups inside the native update callback", async () => {
    const root = document.createElement("div");
    const resolvers: Record<string, (value: string) => void> = {};
    let setPage!: (value: "a" | "b") => void;
    let capturedText = "";

    (document as any).startViewTransition = vi.fn((update: () => unknown) => {
      const updateCallbackDone = Promise.resolve(update()).then(() => {
        capturedText = root.textContent!;
      });
      return {
        ready: updateCallbackDone,
        finished: updateCallbackDone,
        updateCallbackDone,
        skipTransition() {}
      };
    });

    const dispose = render(() => {
      const [page, _setPage] = createSignal<"a" | "b">("a");
      setPage = _setPage;
      const first = createMemo(async () => {
        const current = page();
        return await new Promise<string>(resolve => (resolvers[`first-${current}`] = resolve));
      });
      const second = createMemo(async () => {
        const current = page();
        return await new Promise<string>(resolve => (resolvers[`second-${current}`] = resolve));
      });

      return (
        <ViewTransition name="async-reveal">
          <Reveal order="together">
            <Loading fallback={<span>A loading</span>} on={page()}>
              <span>{first()}</span>
            </Loading>
            <Loading fallback={<span>B loading</span>} on={page()}>
              <span>{second()}</span>
            </Loading>
          </Reveal>
        </ViewTransition>
      );
    }, root);

    flush();
    resolvers["first-a"]("first-a");
    resolvers["second-a"]("second-a");
    await tick(2);
    flush();
    expect(root.textContent).toBe("first-asecond-a");

    vi.mocked((document as any).startViewTransition).mockClear();
    const transition = startViewTransition(async () => {
      setPage("b");
      flush();
      expect(root.textContent).toBe("A loadingB loading");

      resolvers["first-b"]("first-b");
      await tick(2);
      flush();
      expect(root.textContent).toBe("A loadingB loading");

      resolvers["second-b"]("second-b");
      await tick(2);
      flush();
      expect(root.textContent).toBe("first-bsecond-b");
    });

    expect((document as any).startViewTransition).toHaveBeenCalledTimes(1);
    await transition.updateCallbackDone;
    expect(capturedText).toBe("first-bsecond-b");
    dispose();
  });

  // Companion to the `together` test above: document the actual behavior of the
  // other two Reveal orders when nested inside a ViewTransition. The frontier
  // (sequential) and independent (natural) releases land on separate flushes,
  // but all of them ride the *single* native transition opened by the scope —
  // there is no second `startViewTransition` call, so no superseding/abort.
  test("sequential Reveal advances the frontier inside the native update callback", async () => {
    const root = document.createElement("div");
    const resolvers: Record<string, (value: string) => void> = {};
    let setPage!: (value: "a" | "b") => void;
    let capturedText = "";

    (document as any).startViewTransition = vi.fn((update: () => unknown) => {
      const updateCallbackDone = Promise.resolve(update()).then(() => {
        capturedText = root.textContent!;
      });
      return {
        ready: updateCallbackDone,
        finished: updateCallbackDone,
        updateCallbackDone,
        skipTransition() {}
      };
    });

    const dispose = render(() => {
      const [page, _setPage] = createSignal<"a" | "b">("a");
      setPage = _setPage;
      const first = createMemo(async () => {
        const current = page();
        return await new Promise<string>(resolve => (resolvers[`first-${current}`] = resolve));
      });
      const second = createMemo(async () => {
        const current = page();
        return await new Promise<string>(resolve => (resolvers[`second-${current}`] = resolve));
      });

      return (
        <ViewTransition name="async-reveal">
          <Reveal order="sequential">
            <Loading fallback={<span>A loading</span>} on={page()}>
              <span>{first()}</span>
            </Loading>
            <Loading fallback={<span>B loading</span>} on={page()}>
              <span>{second()}</span>
            </Loading>
          </Reveal>
        </ViewTransition>
      );
    }, root);

    flush();
    resolvers["first-a"]("first-a");
    resolvers["second-a"]("second-a");
    await tick(2);
    flush();
    expect(root.textContent).toBe("first-asecond-a");

    vi.mocked((document as any).startViewTransition).mockClear();
    const transition = startViewTransition(async () => {
      setPage("b");
      flush();
      expect(root.textContent).toBe("A loadingB loading");

      // Frontier advance: the first slot reveals the moment it resolves, while
      // the second stays on its fallback — unlike `together`, which holds the
      // whole group until both are ready.
      resolvers["first-b"]("first-b");
      await tick(2);
      flush();
      expect(root.textContent).toBe("first-bB loading");

      resolvers["second-b"]("second-b");
      await tick(2);
      flush();
      expect(root.textContent).toBe("first-bsecond-b");
    });

    // Both staggered releases rode the one transition the scope opened.
    expect((document as any).startViewTransition).toHaveBeenCalledTimes(1);
    await transition.updateCallbackDone;
    expect(capturedText).toBe("first-bsecond-b");
    dispose();
  });

  test("natural Reveal reveals each slot independently inside the native update callback", async () => {
    const root = document.createElement("div");
    const resolvers: Record<string, (value: string) => void> = {};
    let setPage!: (value: "a" | "b") => void;
    let capturedText = "";

    (document as any).startViewTransition = vi.fn((update: () => unknown) => {
      const updateCallbackDone = Promise.resolve(update()).then(() => {
        capturedText = root.textContent!;
      });
      return {
        ready: updateCallbackDone,
        finished: updateCallbackDone,
        updateCallbackDone,
        skipTransition() {}
      };
    });

    const dispose = render(() => {
      const [page, _setPage] = createSignal<"a" | "b">("a");
      setPage = _setPage;
      const first = createMemo(async () => {
        const current = page();
        return await new Promise<string>(resolve => (resolvers[`first-${current}`] = resolve));
      });
      const second = createMemo(async () => {
        const current = page();
        return await new Promise<string>(resolve => (resolvers[`second-${current}`] = resolve));
      });

      return (
        <ViewTransition name="async-reveal">
          <Reveal order="natural">
            <Loading fallback={<span>A loading</span>} on={page()}>
              <span>{first()}</span>
            </Loading>
            <Loading fallback={<span>B loading</span>} on={page()}>
              <span>{second()}</span>
            </Loading>
          </Reveal>
        </ViewTransition>
      );
    }, root);

    flush();
    resolvers["first-a"]("first-a");
    resolvers["second-a"]("second-a");
    await tick(2);
    flush();
    expect(root.textContent).toBe("first-asecond-a");

    vi.mocked((document as any).startViewTransition).mockClear();
    const transition = startViewTransition(async () => {
      setPage("b");
      flush();
      expect(root.textContent).toBe("A loadingB loading");

      // Out of order: the second slot resolves first and reveals on its own
      // while the first stays on its fallback — impossible under `sequential`
      // (frontier order) or `together` (atomic release).
      resolvers["second-b"]("second-b");
      await tick(2);
      flush();
      expect(root.textContent).toBe("A loadingsecond-b");

      resolvers["first-b"]("first-b");
      await tick(2);
      flush();
      expect(root.textContent).toBe("first-bsecond-b");
    });

    // Independent releases still ride the one transition the scope opened.
    expect((document as any).startViewTransition).toHaveBeenCalledTimes(1);
    await transition.updateCallbackDone;
    expect(capturedText).toBe("first-bsecond-b");
    dispose();
  });

  // Inverse nesting: a ViewTransition *inside* each Reveal slot. Now each slot is
  // its own boundary, so releasing it is a *mount* (the enter path), not a
  // content change of one outer boundary. `restore()` runs via `.finally` on the
  // whole async chain, so `activeViewTransition` stays set across the scope's
  // intermediate flushes — each staggered mount fires its own onEnter, all
  // attributed to the single transition the scope opened.
  test("sequential Reveal fires each slot's nested onEnter as the frontier advances", async () => {
    const root = document.createElement("div");
    const resolvers: Record<string, (value: string) => void> = {};
    const onEnterA = vi.fn();
    const onEnterB = vi.fn();
    let setShow!: (value: boolean) => void;

    (document as any).startViewTransition = vi.fn((update: () => unknown) => {
      const updateCallbackDone = Promise.resolve(update());
      return {
        ready: updateCallbackDone,
        finished: updateCallbackDone,
        updateCallbackDone,
        skipTransition() {}
      };
    });

    const dispose = render(() => {
      const [show, _setShow] = createSignal(false);
      setShow = _setShow;
      const first = createMemo(async () =>
        show() ? await new Promise<string>(resolve => (resolvers.first = resolve)) : ""
      );
      const second = createMemo(async () =>
        show() ? await new Promise<string>(resolve => (resolvers.second = resolve)) : ""
      );

      return (
        <Show when={show()}>
          <Reveal order="sequential">
            <Loading fallback={<span>A loading</span>} on={show()}>
              <ViewTransition name="vt-a" onEnter={onEnterA}>
                <span>{first()}</span>
              </ViewTransition>
            </Loading>
            <Loading fallback={<span>B loading</span>} on={show()}>
              <ViewTransition name="vt-b" onEnter={onEnterB}>
                <span>{second()}</span>
              </ViewTransition>
            </Loading>
          </Reveal>
        </Show>
      );
    }, root);

    flush();
    expect(root.textContent).toBe("");

    const transition = startViewTransition(async () => {
      setShow(true);
      flush();
      expect(root.textContent).toBe("A loadingB loading");
      expect(onEnterA).not.toHaveBeenCalled();
      expect(onEnterB).not.toHaveBeenCalled();

      // Frontier advance: slot A's boundary mounts the moment it resolves and
      // fires its own onEnter, while slot B is still on its fallback (unmounted,
      // so its onEnter has not fired).
      resolvers.first("first");
      await tick(2);
      flush();
      expect(root.textContent).toBe("firstB loading");
      expect(onEnterA).toHaveBeenCalledTimes(1);
      expect(onEnterB).not.toHaveBeenCalled();

      resolvers.second("second");
      await tick(2);
      flush();
      expect(root.textContent).toBe("firstsecond");
    });

    await transition.updateCallbackDone;
    await tick(2);
    // Both nested boundaries entered, each once, riding the single transition.
    expect((document as any).startViewTransition).toHaveBeenCalledTimes(1);
    expect(onEnterA).toHaveBeenCalledTimes(1);
    expect(onEnterB).toHaveBeenCalledTimes(1);
    expect(onEnterA.mock.calls[0][0]).toMatchObject({ name: "vt-a" });
    expect(onEnterB.mock.calls[0][0]).toMatchObject({ name: "vt-b" });
    dispose();
  });

  test("natural Reveal fires each slot's nested onEnter independently as it resolves", async () => {
    const root = document.createElement("div");
    const resolvers: Record<string, (value: string) => void> = {};
    const onEnterA = vi.fn();
    const onEnterB = vi.fn();
    let setShow!: (value: boolean) => void;

    (document as any).startViewTransition = vi.fn((update: () => unknown) => {
      const updateCallbackDone = Promise.resolve(update());
      return {
        ready: updateCallbackDone,
        finished: updateCallbackDone,
        updateCallbackDone,
        skipTransition() {}
      };
    });

    const dispose = render(() => {
      const [show, _setShow] = createSignal(false);
      setShow = _setShow;
      const first = createMemo(async () =>
        show() ? await new Promise<string>(resolve => (resolvers.first = resolve)) : ""
      );
      const second = createMemo(async () =>
        show() ? await new Promise<string>(resolve => (resolvers.second = resolve)) : ""
      );

      return (
        <Show when={show()}>
          <Reveal order="natural">
            <Loading fallback={<span>A loading</span>} on={show()}>
              <ViewTransition name="vt-a" onEnter={onEnterA}>
                <span>{first()}</span>
              </ViewTransition>
            </Loading>
            <Loading fallback={<span>B loading</span>} on={show()}>
              <ViewTransition name="vt-b" onEnter={onEnterB}>
                <span>{second()}</span>
              </ViewTransition>
            </Loading>
          </Reveal>
        </Show>
      );
    }, root);

    flush();
    expect(root.textContent).toBe("");

    const transition = startViewTransition(async () => {
      setShow(true);
      flush();
      expect(root.textContent).toBe("A loadingB loading");

      // Out of order: slot B resolves first, mounts its boundary, and fires its
      // own onEnter while slot A is still on its fallback — impossible under
      // sequential (frontier order) or together (atomic release).
      resolvers.second("second");
      await tick(2);
      flush();
      expect(root.textContent).toBe("A loadingsecond");
      expect(onEnterB).toHaveBeenCalledTimes(1);
      expect(onEnterA).not.toHaveBeenCalled();

      resolvers.first("first");
      await tick(2);
      flush();
      expect(root.textContent).toBe("firstsecond");
    });

    await transition.updateCallbackDone;
    await tick(2);
    expect((document as any).startViewTransition).toHaveBeenCalledTimes(1);
    expect(onEnterA).toHaveBeenCalledTimes(1);
    expect(onEnterB).toHaveBeenCalledTimes(1);
    dispose();
  });

  test("fires onGestureEnter instead of onEnter during a gesture transition", async () => {
    const root = document.createElement("div");
    const timeline = { currentTime: 0 };
    const onEnter = vi.fn();
    const onGestureEnter = vi.fn();
    let dispose!: () => void;

    startGestureTransition(
      timeline,
      () => {
        addTransitionType("swipe");
        dispose = render(
          () => (
            <ViewTransition name="gesture-enter" onEnter={onEnter} onGestureEnter={onGestureEnter}>
              <span>Gesture enter</span>
            </ViewTransition>
          ),
          root
        );
      },
      { rangeStart: 0.2, rangeEnd: 0.8 }
    );

    await tick();

    expect(onEnter).not.toHaveBeenCalled();
    expect(onGestureEnter).toHaveBeenCalledTimes(1);
    expect(onGestureEnter.mock.calls[0][0]).toBe(timeline);
    expect(onGestureEnter.mock.calls[0][1]).toEqual({ rangeStart: 0.2, rangeEnd: 0.8 });
    expect(onGestureEnter.mock.calls[0][3]).toEqual(["swipe"]);
    dispose();
  });

  test("fires onGestureUpdate during a gesture transition", async () => {
    const root = document.createElement("div");
    const [text, setText] = createSignal("Before");
    const timeline = {};
    const onUpdate = vi.fn();
    const onGestureUpdate = vi.fn();
    const dispose = render(
      () => (
        <ViewTransition name="gesture-update" onUpdate={onUpdate} onGestureUpdate={onGestureUpdate}>
          <span>{text()}</span>
        </ViewTransition>
      ),
      root
    );

    await tick();

    startGestureTransition(timeline, () => {
      addTransitionType("drag");
      setText("After");
    });
    await tick(2);

    expect(onUpdate).not.toHaveBeenCalled();
    expect(onGestureUpdate).toHaveBeenCalledTimes(1);
    expect(onGestureUpdate.mock.calls[0][3]).toEqual(["drag"]);
    dispose();
  });

  test("fires onGestureExit during a gesture transition", async () => {
    const root = document.createElement("div");
    const [show, setShow] = createSignal(true);
    const timeline = {};
    const onExit = vi.fn();
    const onGestureExit = vi.fn();
    const dispose = render(
      () => (
        <Show when={show()}>
          <ViewTransition name="gesture-exit" onExit={onExit} onGestureExit={onGestureExit}>
            <span>Gesture exit</span>
          </ViewTransition>
        </Show>
      ),
      root
    );

    await tick();

    startGestureTransition(timeline, () => {
      addTransitionType("swipe-away");
      setShow(false);
    });
    await tick();

    expect(onExit).not.toHaveBeenCalled();
    expect(onGestureExit).toHaveBeenCalledTimes(1);
    expect(onGestureExit.mock.calls[0][3]).toEqual(["swipe-away"]);
    dispose();
  });

  test("fires onGestureShare for same-name gesture replacements", async () => {
    const root = document.createElement("div");
    const [page, setPage] = createSignal<"a" | "b">("a");
    const timeline = {};
    const onShare = vi.fn();
    const onGestureShare = vi.fn();
    const dispose = render(
      () => (
        <Show
          when={page() === "a"}
          keyed
          fallback={
            <ViewTransition name="gesture-share">
              <span>Gesture B</span>
            </ViewTransition>
          }
        >
          <ViewTransition name="gesture-share" onShare={onShare} onGestureShare={onGestureShare}>
            <span>Gesture A</span>
          </ViewTransition>
        </Show>
      ),
      root
    );

    await tick();
    onShare.mockClear();

    startGestureTransition(timeline, () => {
      addTransitionType("replace");
      setPage("b");
    });
    await tick();

    expect(onShare).not.toHaveBeenCalled();
    expect(onGestureShare).toHaveBeenCalledTimes(1);
    expect(onGestureShare.mock.calls[0][3]).toEqual(["replace"]);
    dispose();
  });

  // Solid can't take React's clone-preview path for gestures (its reactive graph
  // is bound to the live DOM nodes the browser snapshots), so a gesture mutates
  // the real tree. The most visible casualty is a focused field that gets
  // reparented/reordered — the browser blurs it. A gesture preserves focus + the
  // caret for a field that survives the transition.
  test("preserves focus + caret when a gesture reorders the focused field", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const [items, setItems] = createSignal([{ id: "a" }, { id: "b" }, { id: "c" }]);
    const inputs: Record<string, HTMLInputElement> = {};

    render(
      () => (
        <For each={items()}>
          {item => <input ref={el => (inputs[item.id] = el)} value={item.id} />}
        </For>
      ),
      root
    );
    await tick();

    inputs.b.focus();
    inputs.b.setSelectionRange(1, 1);
    expect(document.activeElement).toBe(inputs.b);

    const gesture = startGestureTransition(
      {},
      () => {
        setItems(list => [list[1], list[0], list[2]]);
        flush();
      },
      { rangeStart: 0, rangeEnd: 1 }
    );
    gesture.commitGesture();
    await tick(2);

    // The keyed row's input node survives the reorder; focus + caret restored.
    expect(inputs.b.isConnected).toBe(true);
    expect(document.activeElement).toBe(inputs.b);
    expect(inputs.b.selectionStart).toBe(1);
    root.remove();
  });

  test("does not steal focus the scope moved elsewhere during a gesture", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const [n, setN] = createSignal(0);
    let a!: HTMLInputElement;
    let b!: HTMLInputElement;

    render(
      () => (
        <div>
          <input ref={a} />
          <input ref={b} />
          {n()}
        </div>
      ),
      root
    );
    await tick();
    a.focus();

    const gesture = startGestureTransition(
      {},
      () => {
        setN(1);
        b.focus();
        flush();
      },
      { rangeStart: 0, rangeEnd: 1 }
    );
    gesture.commitGesture();
    await tick(2);

    // Focus was deliberately moved to `b` inside the scope — leave it there.
    expect(document.activeElement).toBe(b);
    root.remove();
  });

  // Element-local scroll: a scroll container in the focused element's ancestry
  // that a surviving-node mutation resets (e.g. browser detach+reattach) is
  // restored. jsdom keeps scroll across reparenting, so the scope resets it here
  // to stand in for that browser behavior.
  test("restores a scrolled ancestor reset during a non-scroll-timeline gesture", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const [n, setN] = createSignal(0);
    let scroller!: HTMLDivElement;
    let input!: HTMLInputElement;

    render(
      () => (
        <div ref={scroller}>
          <input ref={input} />
          {n()}
        </div>
      ),
      root
    );
    await tick();
    input.focus();
    scroller.scrollTop = 120;

    const gesture = startGestureTransition(
      {},
      () => {
        setN(1);
        scroller.scrollTop = 0;
        flush();
      },
      { rangeStart: 0, rangeEnd: 1 }
    );
    gesture.commitGesture();
    await tick(2);

    expect(scroller.scrollTop).toBe(120);
    root.remove();
  });

  // A scroll-driven gesture (native AnimationTimeline, e.g. ScrollTimeline) reads
  // the very offsets we'd restore — so scroll must be left untouched.
  test("leaves scroll untouched for a scroll-driven (AnimationTimeline) gesture", async () => {
    (globalThis as { AnimationTimeline?: unknown }).AnimationTimeline = class {};
    try {
      const root = document.createElement("div");
      document.body.appendChild(root);
      const [n, setN] = createSignal(0);
      let scroller!: HTMLDivElement;
      let input!: HTMLInputElement;

      render(
        () => (
          <div ref={scroller}>
            <input ref={input} />
            {n()}
          </div>
        ),
        root
      );
      await tick();
      input.focus();
      scroller.scrollTop = 120;

      const timeline = new (
        globalThis as { AnimationTimeline: new () => object }
      ).AnimationTimeline();
      const gesture = startGestureTransition(
        timeline,
        () => {
          setN(1);
          scroller.scrollTop = 0;
          flush();
        },
        { rangeStart: 0, rangeEnd: 1 }
      );
      gesture.commitGesture();
      await tick(2);

      expect(scroller.scrollTop).toBe(0);
      root.remove();
    } finally {
      delete (globalThis as { AnimationTimeline?: unknown }).AnimationTimeline;
    }
  });

  test("binds gesture transition animations to a custom timeline provider", async () => {
    const root = document.createElement("div");
    const animation = {
      effect: {
        pseudoElement: "::view-transition-new(gesture-bind)",
        updateTiming: vi.fn()
      }
    } as unknown as Animation;
    const cleanup = vi.fn();
    const timeline = {
      animate: vi.fn(() => cleanup)
    };
    const originalGetAnimations = document.documentElement.getAnimations;
    document.documentElement.getAnimations = vi.fn(() => [
      animation
    ]) as typeof document.documentElement.getAnimations;

    const transition = startGestureTransition(
      timeline,
      () => {
        render(
          () => (
            <ViewTransition name="gesture-bind">
              <span>Gesture bind</span>
            </ViewTransition>
          ),
          root
        );
      },
      { rangeStart: 0.25, rangeEnd: 0.75 }
    );

    await transition.ready;
    await tick();

    expect(animation.effect?.updateTiming).toHaveBeenCalledWith({ easing: "linear", fill: "both" });
    expect(timeline.animate).toHaveBeenCalledWith(animation, { rangeStart: 0.25, rangeEnd: 0.75 });

    await transition.finished;
    await tick();
    expect(cleanup).toHaveBeenCalledTimes(1);
    document.documentElement.getAnimations = originalGetAnimations;
  });

  test("rebinds native gesture animations onto the timeline range and keeps the transition alive", async () => {
    const root = document.createElement("div");
    const documentElement = document.documentElement;

    const hadAnimationTimeline = "AnimationTimeline" in globalThis;
    const OriginalAnimationTimeline = (globalThis as any).AnimationTimeline;
    if (!hadAnimationTimeline) {
      (globalThis as any).AnimationTimeline = class AnimationTimeline {};
    }
    const timeline = Object.create((globalThis as any).AnimationTimeline.prototype);

    const cancelAuto = vi.fn();
    const autoAnimation = {
      playState: "running",
      cancel: cancelAuto,
      effect: {
        pseudoElement: "::view-transition-new(card)",
        target: documentElement,
        getTiming: () => ({ delay: 0, duration: 200, direction: "normal" }),
        getKeyframes: () => [{ opacity: 0 }, { opacity: 1 }]
      }
    } as unknown as Animation;

    const created: any[] = [];
    const originalGetAnimations = documentElement.getAnimations;
    const originalAnimate = documentElement.animate;
    documentElement.getAnimations = vi.fn(() => [
      autoAnimation
    ]) as typeof documentElement.getAnimations;
    documentElement.animate = vi.fn((keyframes: any, options: any) => {
      const animation = { cancel: vi.fn(), pause: vi.fn(), keyframes, options };
      created.push(animation);
      return animation as unknown as Animation;
    }) as typeof documentElement.animate;

    try {
      const transition = startGestureTransition(
        timeline,
        () => {
          render(
            () => (
              <ViewTransition name="card">
                <span>Card</span>
              </ViewTransition>
            ),
            root
          );
        },
        { rangeStart: 0, rangeEnd: 100 }
      );

      await transition.ready;
      await tick();

      // The auto time-based animation is cancelled and recreated bound to the gesture timeline.
      expect(cancelAuto).toHaveBeenCalledTimes(1);
      const recreated = created.find(
        a => a.options.pseudoElement === "::view-transition-new(card)"
      );
      expect(recreated).toBeDefined();
      expect(recreated.options.timeline).toBe(timeline);
      expect(recreated.options.easing).toBe("linear");
      expect(recreated.options.fill).toBe("both");
      // rangeStart < rangeEnd → played in reverse, mapped across the full range.
      expect(recreated.options.direction).toBe("reverse");
      expect(recreated.options.rangeStart).toBe("0%");
      expect(recreated.options.rangeEnd).toBe("100%");

      // A paused blocking animation keeps the transition alive at the timeline extent.
      const blocking = created.find(
        a => a.options.pseudoElement === "::view-transition" && a.options.duration === 1
      );
      expect(blocking).toBeDefined();
      expect(blocking.pause).toHaveBeenCalledTimes(1);

      await transition.finished;
      await tick();
      expect(recreated.cancel).toHaveBeenCalledTimes(1);
      expect(blocking.cancel).toHaveBeenCalledTimes(1);
    } finally {
      documentElement.getAnimations = originalGetAnimations;
      documentElement.animate = originalAnimate;
      if (!hadAnimationTimeline) delete (globalThis as any).AnimationTimeline;
      else (globalThis as any).AnimationTimeline = OriginalAnimationTimeline;
    }
  });

  test("forces a layout read before starting a gesture transition", () => {
    const spy = vi.spyOn(document.documentElement, "clientHeight", "get");
    try {
      startGestureTransition({}, () => {}, { rangeStart: 0, rangeEnd: 1 });
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  test("cancels gesture signal writes back to the previous DOM state", async () => {
    const root = document.createElement("div");
    const [text, setText] = createSignal("Before");
    const timeline = { currentTime: 0.25 };
    let span!: HTMLSpanElement;

    const dispose = render(
      () => (
        <ViewTransition name="gesture-cancel">
          <span ref={span}>{text()}</span>
        </ViewTransition>
      ),
      root
    );
    await tick();

    const transition = startGestureTransition(
      timeline,
      () => {
        setText("After");
      },
      { rangeStart: 0, rangeEnd: 1 }
    );
    await transition.updateCallbackDone;
    expect(span.textContent).toBe("After");

    transition.finishGesture();
    expect(span.textContent).toBe("Before");
    expect(transitions.at(-1)?.skipTransition).toHaveBeenCalledTimes(1);
    dispose();
  });

  test("commits gesture signal writes past the timeline midpoint", async () => {
    const root = document.createElement("div");
    const [text, setText] = createSignal("Before");
    const timeline = { currentTime: 0.75 };
    let span!: HTMLSpanElement;

    const dispose = render(
      () => (
        <ViewTransition name="gesture-commit">
          <span ref={span}>{text()}</span>
        </ViewTransition>
      ),
      root
    );
    await tick();

    const transition = startGestureTransition(
      timeline,
      () => {
        setText("After");
      },
      { rangeStart: 0, rangeEnd: 1 }
    );
    await transition.updateCallbackDone;
    expect(span.textContent).toBe("After");

    transition.finishGesture();
    expect(span.textContent).toBe("After");
    // Commit keeps the new signal state AND finalizes the browser transition via
    // skipTransition(): a scrubbable provider pauses the pseudo animations to hold
    // the scrub, so their `finished` never resolves on its own. Without this, a
    // committed gesture would leave the destination buried under a frozen
    // full-page snapshot in a real browser until the next transition (jsdom's mock
    // resolves `finished` synchronously and hides the leak). skipTransition() ends
    // the transition at the committed destination, releasing the snapshot.
    expect(transitions.at(-1)?.skipTransition).toHaveBeenCalledTimes(1);
    dispose();
  });

  test("retains same-provider gesture writes until the last gesture handle finishes", async () => {
    const root = document.createElement("div");
    const [text, setText] = createSignal("Before");
    const timeline = { currentTime: 0.25 };
    let span!: HTMLSpanElement;

    const dispose = render(
      () => (
        <ViewTransition name="gesture-ref-count">
          <span ref={span}>{text()}</span>
        </ViewTransition>
      ),
      root
    );
    await tick();

    const first = startGestureTransition(timeline, () => setText("First"), {
      rangeStart: 0,
      rangeEnd: 1
    });
    await first.updateCallbackDone;

    const second = startGestureTransition(timeline, () => setText("Second"), {
      rangeStart: 0,
      rangeEnd: 1
    });
    await second.updateCallbackDone;
    expect(span.textContent).toBe("Second");

    first.finishGesture();
    expect(span.textContent).toBe("Second");
    expect(transitions.at(-2)?.skipTransition).not.toHaveBeenCalled();

    second.finishGesture();
    expect(span.textContent).toBe("Before");
    expect(transitions.at(-1)?.skipTransition).toHaveBeenCalledTimes(1);
    dispose();
  });

  // These tests document a deliberate, architectural divergence from React's
  // gesture model, not a bug. React previews a gesture WITHOUT committing: it
  // renders an alternate fiber tree into new/cloned host nodes and never
  // disposes the live committed instances, so the interactive DOM underneath a
  // scrub stays at the CURRENT state and a cancel is a true no-op.
  //
  // Solid has a single live reactive state with no alternate tree. The only way
  // to compute the destination is to run the reactive scope, whose render
  // effects are bound to the live nodes. For a STRUCTURAL change this disposes
  // the current branch; the gesture transaction then reverts the signals, which
  // RECREATES the branch as fresh nodes. The original nodes (and their focus,
  // scroll, <video> playback, third-party widget state) cannot be recovered by
  // any clone-snapshot orchestration, because the disposal happens while
  // computing the destination — before any clone could stand in for them.
  //
  // See VIEW_TRANSITIONS.md ("Gesture preview model") for the full rationale.
  describe("gesture preview: documented divergence from React", () => {
    test("a structurally-replaced branch is disposed and recreated across a cancelled gesture", () => {
      const root = document.createElement("div");
      document.body.appendChild(root); // attach so isConnected is meaningful
      const [which, setWhich] = createSignal<"a" | "b">("a");
      const dispose = render(
        () => (
          <Show when={which() === "a"} keyed fallback={<input id="b" />}>
            <input id="a" />
          </Show>
        ),
        root
      );
      flush();

      const originalA = root.querySelector("#a") as HTMLInputElement;
      expect(originalA).toBeTruthy();
      originalA.value = "user input"; // live, user-entered state on the node

      const gesture = startGestureTransition({}, () => {
        setWhich("b");
        flush();
      });
      // During the scrub the live DOM is the destination; the #a branch is gone.
      expect(root.querySelector("#a")).toBeNull();
      expect(root.querySelector("#b")).toBeTruthy();
      // Disposing the branch detached the original node irreversibly.
      expect(originalA.isConnected).toBe(false);

      gesture.cancelGesture();
      flush();

      const restoredA = root.querySelector("#a") as HTMLInputElement;
      expect(restoredA).toBeTruthy();
      // The divergence: the restored branch is a FRESH node, not the original,
      // so any live interactive state on the original is lost. A clone-preview
      // port cannot fix this — the disposal is intrinsic to computing the
      // destination in a single-reactive-state runtime.
      expect(restoredA).not.toBe(originalA);
      expect(restoredA.value).toBe("");
      dispose();
      root.remove();
    });

    test("a reordered (surviving) node keeps its identity through a gesture round trip", () => {
      const root = document.createElement("div");
      document.body.appendChild(root); // attach so isConnected is meaningful
      const a = { id: "a" };
      const b = { id: "b" };
      const c = { id: "c" };
      const [items, setItems] = createSignal([a, b, c]);
      const dispose = render(
        () => (
          <ul>
            <For each={items()}>{item => <li id={`row-${item.id}`}>{item.id}</li>}</For>
          </ul>
        ),
        root
      );
      flush();

      const originalRowA = root.querySelector("#row-a") as HTMLLIElement;
      expect(originalRowA).toBeTruthy();

      // A reorder MOVES keyed nodes rather than disposing them, so identity is
      // preserved. This is the recoverable case the captureInteractionState
      // mitigation targets (focus/scroll re-asserted on a surviving node), and
      // why tabs/routes/reorders are unaffected by the divergence above.
      const gesture = startGestureTransition({}, () => {
        setItems([c, b, a]);
        flush();
      });
      expect(root.querySelector("#row-a")).toBe(originalRowA);
      expect(originalRowA.isConnected).toBe(true);

      gesture.cancelGesture();
      flush();
      expect(root.querySelector("#row-a")).toBe(originalRowA);
      dispose();
      root.remove();
    });
  });

  // React parity (matches react@main `includesOnlyViewTransitionEligibleLanes`):
  // a view-transition event fires ONLY when the DOM change committed inside a
  // transition. A plain reactive write (analogous to React's DefaultLane
  // `setState`) mutates the DOM with no animation; you opt in via
  // `startViewTransition`. This applies uniformly to enter / exit / update /
  // share — mounting or unmounting a boundary outside a transition is silent.
  describe("React parity: events gated on an active transition", () => {
    test("a reactive update OUTSIDE a transition queues no update", async () => {
      const root = document.createElement("div");
      const [text, setText] = createSignal("one");
      const onUpdate = vi.fn();

      const dispose = render(
        () => (
          <ViewTransition name="idle" onUpdate={onUpdate}>
            <span>{text()}</span>
          </ViewTransition>
        ),
        root
      );

      await tick(2);
      vi.mocked((document as any).startViewTransition).mockClear();

      // Simulate a `setInterval(() => setSignal(n => n + 1))` ticking inside the
      // boundary: every plain write must be silent.
      for (let i = 0; i < 5; i++) {
        setText(`tick-${i}`);
        flush();
        await tick(2);
      }

      expect(onUpdate).not.toHaveBeenCalled();
      expect((document as any).startViewTransition).not.toHaveBeenCalled();
      dispose();
    });

    test("a reactive update INSIDE startViewTransition queues exactly one", async () => {
      const root = document.createElement("div");
      const [text, setText] = createSignal("one");
      const onUpdate = vi.fn();

      const dispose = render(
        () => (
          <ViewTransition name="opted-in" onUpdate={onUpdate}>
            <span>{text()}</span>
          </ViewTransition>
        ),
        root
      );

      await tick(2);
      vi.mocked((document as any).startViewTransition).mockClear();

      await inTransition(() => setText("changed"));

      expect(onUpdate).toHaveBeenCalledTimes(1);
      // Exactly one browser transition — the one `startViewTransition` opened.
      // The onUpdate event rides on it; it does not spawn a second.
      expect((document as any).startViewTransition).toHaveBeenCalledTimes(1);
      dispose();
    });

    test("mounting a boundary OUTSIDE a transition does not fire onEnter", async () => {
      const root = document.createElement("div");
      const onEnter = vi.fn();
      const [show, setShow] = createSignal(false);

      const dispose = render(
        () => (
          <Show when={show()}>
            <ViewTransition name="silent-enter" onEnter={onEnter}>
              <span>Hi</span>
            </ViewTransition>
          </Show>
        ),
        root
      );

      await tick(2);
      setShow(true);
      flush();
      await tick(3);

      expect(onEnter).not.toHaveBeenCalled();
      expect((document as any).startViewTransition).not.toHaveBeenCalled();
      dispose();
    });

    test("unmounting a boundary OUTSIDE a transition does not fire onExit", async () => {
      const root = document.createElement("div");
      const onExit = vi.fn();
      const [show, setShow] = createSignal(true);

      const dispose = render(
        () => (
          <Show when={show()}>
            <ViewTransition name="silent-exit" onExit={onExit}>
              <span>Bye</span>
            </ViewTransition>
          </Show>
        ),
        root
      );

      await tick(2);
      setShow(false);
      flush();
      await tick(3);

      expect(onExit).not.toHaveBeenCalled();
      dispose();
    });
  });
});
