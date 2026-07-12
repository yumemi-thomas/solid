import { describe, expect, test } from "vitest";
import { createEffect, createRoot, createStore, flush } from "../../src/index.js";

// storeTraps (store.ts:509-818) defines no preventExtensions/isExtensible
// traps, so Object.freeze(store) forwards [[PreventExtensions]] to the
// *internal* StoreNode target ({ v: source, ... }). Once that target is
// non-extensible the engine enforces the ownKeys proxy invariant against the
// target's real keys, and every subsequent key enumeration on the store —
// Object.keys, spread, JSON.stringify, Object.entries — throws
//   TypeError: 'ownKeys' on proxy: trap result did not include 'v'
// permanently poisoning the store (and leaking the internal target shape).
// Freezing a store should either be rejected (freeze throws) or be a no-op —
// it must not break unrelated reads afterwards.

describe("Object.freeze on a store proxy", () => {
  test("key enumeration still works after an attempted freeze", () => {
    const [state] = createStore({ a: 1, b: 2 });
    try {
      Object.freeze(state);
    } catch {
      // acceptable: rejecting the freeze outright
    }
    expect(Object.keys(state).sort()).toEqual(["a", "b"]);
    expect({ ...state }).toEqual({ a: 1, b: 2 });
    expect(JSON.stringify(state)).toBe('{"a":1,"b":2}');
  });

  test("reactivity still works after an attempted freeze", () => {
    const [state, setState] = createStore({ a: 1 });
    try {
      Object.freeze(state);
    } catch {
      // acceptable
    }
    const seen: number[] = [];
    createRoot(() => {
      createEffect(
        () => state.a,
        v => {
          seen.push(v);
        }
      );
    });
    flush();
    setState(s => {
      s.a = 2;
    });
    flush();
    expect(seen).toEqual([1, 2]);
  });
});
