// 1.x check for wave-2 store finding: reconcile() with keyless wrappable leaves (Date/Map)
import { describe, expect, test } from "vitest";
import { createRoot, createRenderEffect } from "solid-js";
import { createStore, reconcile } from "solid-js/store";

describe("1.x: reconcile with Date/Map leaf values", () => {
  test("Date value change notifies subscribers", () => {
    const [state, setState] = createStore({ updatedAt: new Date(2020, 0, 1) });
    const seen: number[] = [];
    const dispose = createRoot(d => {
      createRenderEffect(() => seen.push(state.updatedAt.getFullYear()));
      return d;
    });
    setState(reconcile({ updatedAt: new Date(2021, 0, 1) }));
    console.log("[w2-leaf] seen:", seen, "current:", state.updatedAt.getFullYear());
    expect(state.updatedAt.getFullYear()).toBe(2021);
    expect(seen[seen.length - 1]).toBe(2021);
    dispose();
  });

  test("Map value change notifies subscribers", () => {
    const [state, setState] = createStore({ cache: new Map([["a", 1]]) });
    const seen: number[] = [];
    const dispose = createRoot(d => {
      createRenderEffect(() => seen.push(state.cache.get("a") ?? -1));
      return d;
    });
    setState(reconcile({ cache: new Map([["a", 2]]) }));
    console.log("[w2-leaf] map seen:", seen, "current:", state.cache.get("a"));
    expect(state.cache.get("a")).toBe(2);
    expect(seen[seen.length - 1]).toBe(2);
    dispose();
  });
});
