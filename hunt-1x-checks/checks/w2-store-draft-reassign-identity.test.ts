// 1.x check for wave-2 store finding: row swap/move preserves store identity of edited rows
import { describe, expect, test } from "vitest";
import { createStore, produce } from "solid-js/store";

describe("1.x: swapping rows preserves proxy identity", () => {
  test("previously-edited row keeps identity across a swap", () => {
    const [state, setState] = createStore({
      list: [
        { id: "a", v: 1 },
        { id: "b", v: 1 }
      ]
    });
    // edit row 0 first (the 2.0 bug only hits previously-written subtrees)
    setState("list", 0, "v", 2);
    const row0 = state.list[0];
    setState(
      "list",
      produce((l: any[]) => {
        const t = l[0];
        l[0] = l[1];
        l[1] = t;
      })
    );
    console.log(
      "[w2-swap] identity kept:",
      state.list[1] === row0,
      "| ids:",
      state.list.map(r => r.id)
    );
    expect(state.list.map(r => r.id)).toEqual(["b", "a"]);
    expect(state.list[1] === row0).toBe(true); // same proxy after the move
    // captured proxy stays connected to store writes
    setState("list", 1, "v", 3);
    expect(row0.v).toBe(3);
  });
});
