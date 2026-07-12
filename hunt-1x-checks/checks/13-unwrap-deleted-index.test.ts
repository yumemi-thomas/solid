// 1.x check for finding 13: unwrap/snapshot of an array store with a deleted trailing index
import { describe, expect, test } from "vitest";
import { createStore, unwrap } from "solid-js/store";

describe("1.x: unwrap after deleting a trailing array index", () => {
  test("keeps the array length", () => {
    const [state, setState] = createStore<(number | undefined)[]>([1, 2, 3]);
    // 1.x: writing undefined deletes the property (documented 1.x semantics)
    setState(2, undefined);
    // eslint-disable-next-line no-console
    console.log("[13] '2 in state':", 2 in state, "state.length:", state.length);
    const raw = unwrap(state);
    // plain JS: deleting an index leaves a hole, length stays 3
    expect(state.length).toBe(3);
    expect(raw.length).toBe(3);
    expect(2 in raw).toBe(false);
  });
});
