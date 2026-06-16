/**
 * @jsxImportSource @solidjs/web
 */
// Real-browser (Chromium) parity tests for `<ViewTransition>`, modelled on the
// examples at https://react.dev/reference/react/ViewTransition (enter on
// add, exit on remove, shared-element transition, reorder/update, styling by
// class name and by transition type, opting out with "none"), plus the two
// React-faithful guards that only have an effect with a real layout engine:
// the viewport guard (`wasInstanceInViewport`) and the `display:inline`
// workaround (`applyViewTransitionName`). jsdom mocks `startViewTransition`
// and has no layout, so these can only be verified here.
//
// A real `document.startViewTransition` invokes its update callback
// asynchronously (next frame), so a class/callback assertion must wait for the
// callback to actually run — `waitUntil` polls across frames rather than
// relying on the animation existing yet.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createSignal, flush, Show } from "solid-js";
import { addTransitionType, render, startViewTransition, ViewTransition } from "@solidjs/web";

const raf = () => new Promise<void>(r => requestAnimationFrame(() => r()));
const waitUntil = async (predicate: () => boolean, frames = 120): Promise<boolean> => {
  for (let i = 0; i < frames; i++) {
    if (predicate()) return true;
    await raf();
  }
  return predicate();
};
const frames = async (n: number) => {
  for (let i = 0; i < n; i++) await raf();
};
// `view-transition-class`/`display` are live only while a phase is mid-flight;
// read them from inside the callback for a deterministic assertion.
const vtClass = (el: Element): string =>
  ((el as HTMLElement).style as CSSStyleDeclaration & { viewTransitionClass?: string })
    .viewTransitionClass ?? "";

let container: HTMLDivElement;
let svtCalls: number;
let realSVT: typeof document.startViewTransition;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  svtCalls = 0;
  realSVT = document.startViewTransition;
  (document as any).startViewTransition = function (this: Document, ...args: unknown[]) {
    svtCalls++;
    return (realSVT as any).apply(this, args);
  };
});

afterEach(() => {
  (document as any).startViewTransition = realSVT;
  container.remove();
});

// ── react.dev: "Reveal" a component (enter on add) ──────────────────────────
test("enter: mounting a boundary inside startViewTransition fires onEnter once", async () => {
  const [show, setShow] = createSignal(false);
  let enterClass = "";
  const onEnter = vi.fn((inst: any) => {
    enterClass = vtClass(inst.nodes[0]);
  });
  const dispose = render(
    () => (
      <Show when={show()}>
        <ViewTransition name="hero" enter="enter-anim" default="default-anim" onEnter={onEnter}>
          <div>Hero</div>
        </ViewTransition>
      </Show>
    ),
    container
  );
  await raf();
  expect(onEnter).not.toHaveBeenCalled();

  startViewTransition(() => {
    setShow(true);
    flush();
  });
  await waitUntil(() => onEnter.mock.calls.length > 0);

  expect(onEnter).toHaveBeenCalledTimes(1);
  expect(enterClass).toBe("enter-anim"); // event class wins over default
  expect(svtCalls).toBe(1); // rides on the one transition; no second
  dispose();
});

// ── react.dev: removal (exit on unmount) ────────────────────────────────────
test("exit: unmounting a boundary inside startViewTransition fires onExit once", async () => {
  const [show, setShow] = createSignal(true);
  const onExit = vi.fn();
  const dispose = render(
    () => (
      <Show when={show()}>
        <ViewTransition name="toast" exit="exit-anim" onExit={onExit}>
          <div>Toast</div>
        </ViewTransition>
      </Show>
    ),
    container
  );
  await raf();

  startViewTransition(() => {
    setShow(false);
    flush();
  });
  await waitUntil(() => onExit.mock.calls.length > 0);

  expect(onExit).toHaveBeenCalledTimes(1);
  dispose();
});

// ── react.dev: shared element transition (same name appears + disappears) ───
test("share: same-name swap inside a transition fires onShare, not enter/exit", async () => {
  const [page, setPage] = createSignal<"a" | "b">("a");
  const onShare = vi.fn();
  const onExit = vi.fn();
  const onEnter = vi.fn();
  const dispose = render(
    () => (
      <Show
        when={page() === "a"}
        keyed
        fallback={
          <ViewTransition name="card" share="share-anim" onEnter={onEnter}>
            <div>B</div>
          </ViewTransition>
        }
      >
        <ViewTransition name="card" share="share-anim" onShare={onShare} onExit={onExit}>
          <div>A</div>
        </ViewTransition>
      </Show>
    ),
    container
  );
  await raf();
  onShare.mockClear();
  onExit.mockClear();
  onEnter.mockClear();

  startViewTransition(() => {
    setPage("b");
    flush();
  });
  await waitUntil(() => onShare.mock.calls.length > 0);

  expect(onShare).toHaveBeenCalledTimes(1);
  expect(onExit).not.toHaveBeenCalled();
  expect(onEnter).not.toHaveBeenCalled();
  dispose();
});

// ── react.dev: reorder/resize (update on a staying boundary) ────────────────
test("update: content change inside a transition fires onUpdate once", async () => {
  const [text, setText] = createSignal("short");
  const onUpdate = vi.fn();
  const dispose = render(
    () => (
      <ViewTransition name="row" update="update-anim" onUpdate={onUpdate}>
        {/* inline-block so the box width tracks the text → a real geometry change */}
        <span style={{ display: "inline-block" }}>{text()}</span>
      </ViewTransition>
    ),
    container
  );
  await raf();

  startViewTransition(() => {
    setText("a much longer string that changes layout");
    flush();
  });
  await waitUntil(() => onUpdate.mock.calls.length > 0);

  expect(onUpdate).toHaveBeenCalledTimes(1);
  dispose();
});

// Geometry-driven parity #1: a content change that does NOT alter the box (a
// fixed-size, overflow-clipped element) fires nothing — React's hasInstanceChanged
// cancels a no-geometry-change update. (The old mutation-driven model fired here.)
test("update: a content change with unchanged geometry does NOT fire onUpdate", async () => {
  const [text, setText] = createSignal("aaa");
  const onUpdate = vi.fn();
  const dispose = render(
    () => (
      <ViewTransition name="fixed" onUpdate={onUpdate}>
        <div style={{ width: "80px", height: "20px", overflow: "hidden" }}>{text()}</div>
      </ViewTransition>
    ),
    container
  );
  await raf();

  startViewTransition(() => {
    setText("completely different content but the box is clipped to 80x20");
    flush();
  });
  await frames(10); // give it every chance to (wrongly) fire

  expect(onUpdate).not.toHaveBeenCalled();
  dispose();
});

// Geometry-driven parity #2: a boundary that MOVES because a sibling resized —
// with NO DOM mutation of its own — still animates. This is the case the old
// mutation-driven detection missed entirely (no write inside the boundary →
// nothing observed); geometry measurement catches the rect.y delta, like React.
test("update: a pure layout shift (no own mutation) fires onUpdate", async () => {
  const [tall, setTall] = createSignal(false);
  const onUpdate = vi.fn();
  const dispose = render(
    () => (
      <>
        {/* sibling that grows — not a ViewTransition, just pushes the box below */}
        <div style={{ height: tall() ? "300px" : "20px" }}>spacer</div>
        <ViewTransition name="pushed" onUpdate={onUpdate}>
          <div>I never change, but I move when the spacer grows</div>
        </ViewTransition>
      </>
    ),
    container
  );
  await raf();

  startViewTransition(() => {
    setTall(true);
    flush();
  });
  await waitUntil(() => onUpdate.mock.calls.length > 0);

  expect(onUpdate).toHaveBeenCalledTimes(1);
  dispose();
});

// ── react.dev: customizing with transition types ────────────────────────────
test("transition types reach the class map and the callback", async () => {
  const [show, setShow] = createSignal(false);
  let enterClass = "";
  let receivedTypes: string[] = [];
  const onEnter = vi.fn((inst: any, types: string[]) => {
    enterClass = vtClass(inst.nodes[0]);
    receivedTypes = types;
  });
  const dispose = render(
    () => (
      <Show when={show()}>
        <ViewTransition
          name="typed"
          enter={{ default: "default-enter", nav: "nav-enter" }}
          onEnter={onEnter}
        >
          <div>Typed</div>
        </ViewTransition>
      </Show>
    ),
    container
  );
  await raf();

  startViewTransition(() => {
    addTransitionType("nav");
    setShow(true);
    flush();
  });
  await waitUntil(() => onEnter.mock.calls.length > 0);

  expect(onEnter).toHaveBeenCalledTimes(1);
  expect(enterClass).toBe("nav-enter"); // matched type wins over object default
  expect(receivedTypes).toEqual(["nav"]);
  dispose();
});

// ── react.dev: opting out with "none" ───────────────────────────────────────
test('"none" opts a phase out: no view-transition-class applied', async () => {
  const [show, setShow] = createSignal(false);
  let enterClass = "absent";
  const onEnter = vi.fn((inst: any) => {
    enterClass = vtClass(inst.nodes[0]);
  });
  const dispose = render(
    () => (
      <Show when={show()}>
        <ViewTransition name="excluded" enter="none" onEnter={onEnter}>
          <div>Excluded</div>
        </ViewTransition>
      </Show>
    ),
    container
  );
  await raf();

  startViewTransition(() => {
    setShow(true);
    flush();
  });
  await waitUntil(() => onEnter.mock.calls.length > 0);

  expect(onEnter).toHaveBeenCalledTimes(1);
  expect(enterClass).toBe(""); // "none" → no class
  dispose();
});

// ── React-faithful guard #1: viewport ───────────────────────────────────────
// `wasInstanceInViewport` — an off-screen boundary does not animate/fire even
// when the change commits inside a transition; an on-screen one does.
test("viewport guard: an off-screen boundary does not fire onUpdate", async () => {
  const [a, setA] = createSignal("a0");
  const [b, setB] = createSignal("b0");
  const onUpdateOff = vi.fn();
  const onUpdateOn = vi.fn();
  const dispose = render(
    () => (
      <>
        <ViewTransition name="onscreen" onUpdate={onUpdateOn}>
          <span style={{ display: "inline-block" }}>{a()}</span>
        </ViewTransition>
        {/* pushed far below the viewport */}
        <div style={{ position: "absolute", top: "100000px" }}>
          <ViewTransition name="offscreen" onUpdate={onUpdateOff}>
            <span style={{ display: "inline-block" }}>{b()}</span>
          </ViewTransition>
        </div>
      </>
    ),
    container
  );
  await raf();

  startViewTransition(() => {
    setA("a0 grew much wider now");
    setB("b0 grew much wider now");
    flush();
  });
  await waitUntil(() => onUpdateOn.mock.calls.length > 0);
  await frames(5); // give the off-screen one every chance to (wrongly) fire

  expect(onUpdateOn).toHaveBeenCalledTimes(1); // in viewport → fires
  expect(onUpdateOff).not.toHaveBeenCalled(); // off-screen → suppressed
  dispose();
});

// ── parity: idle updates are silent (no transition every tick) ──────────────
test("idle: a plain reactive update outside a transition fires nothing", async () => {
  const [n, setN] = createSignal(0);
  const onUpdate = vi.fn();
  const dispose = render(
    () => (
      <ViewTransition name="idle" onUpdate={onUpdate}>
        <div>{n()}</div>
      </ViewTransition>
    ),
    container
  );
  await raf();
  svtCalls = 0;

  for (let i = 0; i < 8; i++) {
    setN(v => v + 1);
    flush();
    await raf();
  }
  await frames(5);

  expect(onUpdate).not.toHaveBeenCalled();
  expect(svtCalls).toBe(0);
  dispose();
});
