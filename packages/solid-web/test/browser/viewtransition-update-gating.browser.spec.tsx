/**
 * @jsxImportSource @solidjs/web
 */
// Real-browser proof of the React-parity update gate (jsdom mocks
// `document.startViewTransition`, so the "fires on every mutation" footgun and
// its fix can only be observed against a real implementation).
//
// React drives a commit through `startViewTransition` ONLY when the committing
// lanes are view-transition-eligible (transition / retry / idle) — a plain
// `setState` mutates the DOM with no animation. Solid's analog: a reactive write
// inside a `<ViewTransition>` boundary animates only when it commits inside a
// `startViewTransition` scope. A bare `setInterval(() => setSignal(...))` that
// updates content inside a boundary must fire ZERO browser transitions.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createSignal, flush } from "solid-js";
import { render, startViewTransition, ViewTransition } from "@solidjs/web";

const raf = () => new Promise<void>(r => requestAnimationFrame(() => r()));
const settle = async () => {
  for (let i = 0; i < 60; i++) {
    const vt = document.documentElement
      .getAnimations({ subtree: true })
      .filter(a => (a.effect as KeyframeEffect)?.pseudoElement?.includes?.("::view-transition"));
    if (!vt.length) break;
    await raf();
  }
};
// A real `document.startViewTransition` invokes its update callback async, so
// poll for the callback rather than relying on an animation existing yet.
const waitUntil = async (predicate: () => boolean, framesMax = 120): Promise<boolean> => {
  for (let i = 0; i < framesMax; i++) {
    if (predicate()) return true;
    await raf();
  }
  return predicate();
};

let container: HTMLDivElement;
let calls: number;
let realStart: typeof document.startViewTransition;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  calls = 0;
  realStart = document.startViewTransition;
  // Count every real browser transition while still driving the real one.
  (document as any).startViewTransition = function (this: Document, ...args: unknown[]) {
    calls++;
    return (realStart as any).apply(this, args);
  };
});

afterEach(() => {
  (document as any).startViewTransition = realStart;
  container.remove();
});

test("idle reactive updates inside a boundary fire ZERO browser transitions", async () => {
  const [n, setN] = createSignal(0);
  const onUpdate = vi.fn();
  const dispose = render(
    () => (
      <ViewTransition name="ticking" onUpdate={onUpdate}>
        <span>{n()}</span>
      </ViewTransition>
    ),
    container
  );
  await raf();
  expect(calls).toBe(0); // initial mount, no transition

  // Simulate `setInterval(() => setN(v => v + 1))` ticking outside any transition.
  for (let i = 0; i < 10; i++) {
    setN(v => v + 1);
    flush();
    await raf();
  }
  await settle();

  expect(container.textContent).toBe("10");
  expect(onUpdate).not.toHaveBeenCalled();
  expect(calls).toBe(0);
  dispose();
});

test("an update wrapped in startViewTransition animates exactly once", async () => {
  const [label, setLabel] = createSignal("one");
  const onUpdate = vi.fn();
  const dispose = render(
    () => (
      <ViewTransition name="opted-in" update="u" onUpdate={onUpdate}>
        {/* inline-block so the box width tracks the content and the geometry-
            driven detector sees a real change */}
        <span style={{ display: "inline-block" }}>{label()}</span>
      </ViewTransition>
    ),
    container
  );
  await raf();
  expect(calls).toBe(0);

  startViewTransition(() => {
    setLabel("a considerably wider label");
    flush();
  });
  await waitUntil(() => onUpdate.mock.calls.length > 0);

  expect(container.textContent).toBe("a considerably wider label");
  // Exactly one browser transition — the one startViewTransition opened. The
  // onUpdate event rides on it rather than spawning a second.
  expect(calls).toBe(1);
  expect(onUpdate).toHaveBeenCalledTimes(1);
  dispose();
});
