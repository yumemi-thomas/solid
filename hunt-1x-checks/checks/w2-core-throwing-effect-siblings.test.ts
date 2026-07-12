// 1.x check: does one throwing effect drop sibling effects queued in the same batch?
import { describe, expect, test } from "vitest";
import { createRoot, createSignal, createEffect, batch } from "solid-js";

describe("1.x: throwing effect does not drop sibling effects", () => {
  test("sibling effect still observes the update", () => {
    const seen: number[] = [];
    let setA!: (v: number) => void;
    let setB!: (v: number) => void;
    const dispose = createRoot(d => {
      const [a, sA] = createSignal(0);
      const [b, sB] = createSignal(0);
      setA = sA;
      setB = sB;
      createEffect(() => {
        if (a() === 1) throw new Error("boom");
      });
      createEffect(() => {
        seen.push(b());
      });
      return d;
    });
    expect(seen).toEqual([0]);
    let threw = false;
    try {
      batch(() => {
        setA(1);
        setB(1);
      });
    } catch {
      threw = true;
    }
    console.log("[w2-core-eff] threw:", threw, "seen:", seen);
    expect(seen).toContain(1); // sibling effect must have seen b === 1
    dispose();
  });
});
