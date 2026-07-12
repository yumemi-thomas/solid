// 1.x check for finding 12: getOwnPropertyDescriptor(store, k) after a write
import { describe, expect, test } from "vitest";
import { createStore } from "solid-js/store";

describe("1.x: store getOwnPropertyDescriptor", () => {
  test("descriptor reflects the written value", () => {
    const [state, setState] = createStore<{ n: number }>({ n: 1 });
    setState("n", 2);
    const desc = Object.getOwnPropertyDescriptor(state, "n")!;
    // eslint-disable-next-line no-console
    console.log("[12] descriptor after write:", desc, "state.n:", state.n);
    // correct behavior: reading through the descriptor must not observe the stale value
    const observed = "get" in desc && desc.get ? desc.get() : desc.value;
    expect(observed).toBe(2);
    const descs = Object.getOwnPropertyDescriptors(state) as any;
    const observedAll = descs.n.get ? descs.n.get() : descs.n.value;
    expect(observedAll).toBe(2);
  });
});
