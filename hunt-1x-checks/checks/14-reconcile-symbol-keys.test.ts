// 1.x check for finding 14: does reconcile() diff/notify symbol-keyed properties?
// Writes/assertions happen OUTSIDE the createRoot body (1.x batches inside it).
import { describe, expect, test } from "vitest";
import { createRoot, createRenderEffect } from "solid-js";
import { createStore, reconcile } from "solid-js/store";

const sym = Symbol("k");

describe("1.x: reconcile with symbol keys", () => {
  test("symbol-keyed property is updated and subscribers are notified", () => {
    const [state, setState] = createStore<any>({ [sym]: 1, a: 1 });
    const seen: any[] = [];
    const dispose = createRoot(d => {
      createRenderEffect(() => seen.push(state[sym]));
      return d;
    });
    setState(reconcile({ [sym]: 2, a: 2 }));
    console.log("[14] state[sym]:", state[sym], "state.a:", state.a, "seen:", seen);
    expect(state.a).toBe(2); // control: string key merged
    expect(state[sym]).toBe(2); // symbol value merged at all?
    expect(seen[seen.length - 1]).toBe(2); // subscriber notified?
    dispose();
  });
});
