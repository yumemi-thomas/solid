// 1.x check for finding 4: does a throwing user `equals` permanently kill reactivity?
import { describe, expect, test } from "vitest";
import { createRoot, createSignal, createEffect } from "solid-js";

describe("1.x: throwing equals", () => {
  test("reactivity survives after a throwing equals comparator", () => {
    const seen: number[] = [];
    let set!: (v: number) => void;
    const dispose = createRoot(d => {
      const [s, setS] = createSignal(0, {
        equals: (prev, next) => {
          if (next === 1) throw new Error("boom");
          return prev === next;
        }
      });
      set = setS;
      createEffect(() => seen.push(s()));
      return d;
    });
    // effects flush when the root body completes
    expect(seen).toEqual([0]);
    let threw = false;
    try {
      set(1);
    } catch {
      threw = true;
    }
    // regardless of where the error surfaced, a later write must still propagate
    set(2);
    console.log("[04] write of 1 threw at call site:", threw, "seen:", seen);
    expect(seen[seen.length - 1]).toBe(2);
    dispose();
  });
});
