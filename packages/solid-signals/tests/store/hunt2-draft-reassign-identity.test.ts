import { describe, expect, test } from "vitest";
import { createStore, flush } from "../../src/index.js";

// Every draft assignment routes the incoming value through unwrapStoreValue
// (set trap, store.ts:644). For a store subtree that has a STORE_OVERRIDE
// (i.e. was ever written), unwrapStoreValue does not return the underlying
// value — it materializes a fresh plain clone (store.ts:172-193). So the
// common "move/swap rows" pattern
//   const tmp = s.list[i]; s.list[i] = s.list[j]; s.list[j] = tmp;
// silently *clones* any row that was previously edited: the row loses its
// store identity (keyed <For> tears down and recreates its DOM, component
// state/focus lost) and any previously captured row proxy is permanently
// detached from the store — later writes through the store are invisible
// through it and vice versa.

describe("draft re-assignment of previously-written subtrees", () => {
  test("swapping rows preserves store identity", () => {
    const [state, setState] = createStore({
      list: [
        { id: 1, v: "a" },
        { id: 2, v: "b" }
      ]
    });
    // edit row 0 so it carries an override
    setState(s => {
      s.list[0].v = "a2";
    });
    flush();
    const r0 = state.list[0];
    const r1 = state.list[1];
    setState(s => {
      const tmp = s.list[0];
      s.list[0] = s.list[1];
      s.list[1] = tmp;
    });
    flush();
    expect(state.list[0].id).toBe(2);
    expect(state.list[1].id).toBe(1);
    expect(state.list[1].v).toBe("a2");
    // the untouched row keeps identity (passes today)...
    expect(state.list[0]).toBe(r1);
    // ...the previously-edited row must too (fails: it was cloned)
    expect(state.list[1]).toBe(r0);
  });

  test("captured row proxy stays connected after a move", () => {
    const [state, setState] = createStore({
      list: [
        { id: 1, v: "a" },
        { id: 2, v: "b" }
      ]
    });
    setState(s => {
      s.list[1].v = "b1";
    });
    flush();
    const captured = state.list[1]; // e.g. row store handed to a component
    setState(s => {
      const tmp = s.list[1];
      s.list[1] = s.list[0];
      s.list[0] = tmp;
    });
    flush();
    setState(s => {
      s.list[0].v = "b2";
    });
    flush();
    expect(state.list[0].id).toBe(2);
    expect(state.list[0].v).toBe("b2");
    // same logical row — the captured proxy must observe the write
    expect(captured.v).toBe("b2");
  });
});
