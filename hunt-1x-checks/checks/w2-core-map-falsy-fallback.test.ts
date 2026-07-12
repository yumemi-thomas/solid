// 1.x check: mapArray falsy fallback recreated on every empty update + leaks owners?
import { describe, expect, test } from "vitest";
import { createRoot, createSignal, onCleanup, mapArray } from "solid-js";

describe("1.x: mapArray falsy fallback", () => {
  test("falsy fallback created once while the list stays empty; owners disposed", () => {
    let created = 0;
    let cleaned = 0;
    const [list, setList] = createSignal<number[]>([]);
    let mapped!: () => any;
    const dispose = createRoot(d => {
      mapped = mapArray(list, n => n, {
        fallback: () => {
          created++;
          onCleanup(() => cleaned++);
          return null; // falsy fallback
        }
      });
      mapped(); // realize
      return d;
    });
    // two more empty updates
    setList([]);
    mapped();
    setList([]);
    mapped();
    console.log("[w2-core-fb] created:", created, "cleaned:", cleaned);
    expect(created).toBe(1); // fallback made once, not per empty update
    // now go non-empty: fallback owner disposed
    setList([1]);
    mapped();
    expect(cleaned).toBe(created); // no leaked fallback owners
    dispose();
  });
});
