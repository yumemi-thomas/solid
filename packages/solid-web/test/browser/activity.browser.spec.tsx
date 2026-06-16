/**
 * @jsxImportSource @solidjs/web
 */
// Real-browser (Chromium) tests for `<Activity>` behaviors that need a real
// layout engine: revealing/hiding an Activity that wraps a `<ViewTransition>`
// must fire enter/exit (not update), which depends on a real `display:none` →
// zero-area box that jsdom can't produce. Also confirms the React-faithful
// effect pause (a createEffect timer stops while hidden) end-to-end.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createEffect, createSignal, flush } from "solid-js";
import { Activity, render, startViewTransition, ViewTransition } from "@solidjs/web";

const raf = () => new Promise<void>(r => requestAnimationFrame(() => r()));
const waitUntil = async (predicate: () => boolean, framesMax = 120): Promise<boolean> => {
  for (let i = 0; i < framesMax; i++) {
    if (predicate()) return true;
    await raf();
  }
  return predicate();
};
const frames = async (n: number) => {
  for (let i = 0; i < n; i++) await raf();
};

let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});
afterEach(() => container.remove());

// React parity: flipping an `<Activity>`'s visibility drives a nested
// `<ViewTransition>` through enter/exit — NOT update. (Solid's geometry-driven
// update detector would otherwise see the 0×0 ↔ real box flip as an update.)
test("revealing an Activity fires onEnter (not onUpdate); hiding fires onExit", async () => {
  const [active, setActive] = createSignal<"a" | "b">("a");
  const onEnterA = vi.fn();
  const onExitA = vi.fn();
  const onUpdateA = vi.fn();
  const onEnterB = vi.fn();
  const onExitB = vi.fn();
  const onUpdateB = vi.fn();

  const dispose = render(
    () => (
      <>
        <Activity mode={active() === "a" ? "visible" : "hidden"}>
          <ViewTransition name="pane-a" onEnter={onEnterA} onExit={onExitA} onUpdate={onUpdateA}>
            <div>Pane A</div>
          </ViewTransition>
        </Activity>
        <Activity mode={active() === "b" ? "visible" : "hidden"}>
          <ViewTransition name="pane-b" onEnter={onEnterB} onExit={onExitB} onUpdate={onUpdateB}>
            <div>Pane B</div>
          </ViewTransition>
        </Activity>
      </>
    ),
    container
  );
  await raf();
  // Mounted outside a transition → no enter fired for either (transition-gated).
  expect(onEnterA).not.toHaveBeenCalled();
  expect(onEnterB).not.toHaveBeenCalled();

  // Switch A → B inside a transition: B is revealed, A is hidden.
  startViewTransition(() => {
    setActive("b");
    flush();
  });
  await waitUntil(() => onEnterB.mock.calls.length > 0 && onExitA.mock.calls.length > 0);
  await frames(3);

  expect(onEnterB).toHaveBeenCalledTimes(1); // revealed → enter
  expect(onExitA).toHaveBeenCalledTimes(1); // hidden → exit
  expect(onUpdateB).not.toHaveBeenCalled(); // NOT update
  expect(onUpdateA).not.toHaveBeenCalled();
  expect(onEnterA).not.toHaveBeenCalled();
  expect(onExitB).not.toHaveBeenCalled();
  dispose();
});

// End-to-end (real timers): a createEffect side effect is torn down while the
// Activity is hidden and re-established on show.
test("a createEffect timer pauses while the Activity is hidden and resumes on show", async () => {
  vi.useFakeTimers();
  try {
    const [mode, setMode] = createSignal<"visible" | "hidden">("visible");
    let ticks = 0;

    function Ticker() {
      createEffect(
        () => {},
        () => {
          const id = setInterval(() => ticks++, 100);
          return () => clearInterval(id);
        }
      );
      return <span>ticker</span>;
    }

    const dispose = render(
      () => (
        <Activity mode={mode()}>
          <Ticker />
        </Activity>
      ),
      container
    );
    flush();

    vi.advanceTimersByTime(300);
    expect(ticks).toBe(3); // running while visible

    setMode("hidden");
    flush();
    vi.advanceTimersByTime(500);
    expect(ticks).toBe(3); // paused: clearInterval ran on hide

    setMode("visible");
    flush();
    vi.advanceTimersByTime(200);
    expect(ticks).toBe(5); // resumed: a fresh interval re-established on show
    dispose();
  } finally {
    vi.useRealTimers();
  }
});

// React parity: an effect mounting inside an already-hidden Activity never runs
// until first shown.
test("an effect mounted inside a hidden Activity does not run until shown", async () => {
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
    container
  );
  flush();
  await raf();
  expect(runs).toEqual([]); // mounted hidden → never ran

  setMode("visible");
  flush();
  await raf();
  expect(runs).toEqual([0]); // ran on first show
  dispose();
});
