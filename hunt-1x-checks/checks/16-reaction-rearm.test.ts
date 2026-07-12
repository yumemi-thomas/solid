// 1.x check for finding 16: does re-arming createReaction before it fires replace deps?
import { describe, expect, test } from "vitest";
import { createRoot, createSignal, createReaction } from "solid-js";

describe("1.x: createReaction re-arm", () => {
  test("control: single track() fires once", () => {
    const [b, setB] = createSignal(0);
    let fires = 0;
    let track!: (fn: () => void) => void;
    const dispose = createRoot(d => {
      track = createReaction(() => fires++);
      return d;
    });
    track(() => b());
    setB(1);
    console.log("[16-control] fires after setB:", fires);
    expect(fires).toBe(1);
    setB(2);
    expect(fires).toBe(1);
    dispose();
  });

  test("second track() before firing replaces the tracked sources", () => {
    const [a, setA] = createSignal(0);
    const [b, setB] = createSignal(0);
    let fires = 0;
    let track!: (fn: () => void) => void;
    const dispose = createRoot(d => {
      track = createReaction(() => fires++);
      return d;
    });
    track(() => a());
    track(() => b()); // re-arm before firing: should REPLACE deps, not accumulate
    setA(1);
    console.log("[16] fires after setA:", fires);
    expect(fires).toBe(0); // a should no longer be tracked
    setB(1);
    console.log("[16] fires after setB:", fires);
    expect(fires).toBe(1);
    setB(2);
    expect(fires).toBe(1); // one-shot: disarmed after firing
    dispose();
  });
});
