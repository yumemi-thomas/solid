// 1.x check for wave-2 store finding: Map/Set/Date values in stores
import { describe, expect, test } from "vitest";
import { createStore, produce } from "solid-js/store";

describe("1.x: Map/Set/Date values in stores", () => {
  test("reads of internal-slot accessors work", () => {
    const [state] = createStore({
      cache: new Map([["a", 1]]),
      tags: new Set(["x"]),
      at: new Date(2020, 0, 1)
    });
    expect(state.cache.size).toBe(1);
    expect(state.tags.size).toBe(1);
    expect(state.at.getFullYear()).toBe(2020);
    console.log(
      "[w2-msd] cache is raw Map:",
      state.cache instanceof Map,
      "proxy?",
      state.cache !== null
    );
  });

  test("methods work inside a produce draft", () => {
    const [state, setState] = createStore({
      cache: new Map<string, number>(),
      at: new Date(2020, 0, 1)
    });
    setState(
      produce(s => {
        s.cache.set("k", 42);
        s.at.setFullYear(2021);
      })
    );
    expect(state.cache.get("k")).toBe(42);
    expect(state.at.getFullYear()).toBe(2021);
  });
});
