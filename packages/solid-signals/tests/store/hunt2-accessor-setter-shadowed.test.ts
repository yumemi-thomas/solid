import { describe, expect, test } from "vitest";
import { createStore, flush } from "../../src/index.js";

// Stores support getter accessors (get trap invokes desc.get with the proxy
// receiver, store.ts:542-543), but the set trap (store.ts:633-703) never
// consults the property descriptor: a write to an accessor property skips
// the setter entirely and lands as a plain data value in STORE_OVERRIDE.
// From then on the override *shadows the getter too* (get trap prefers the
// override, store.ts:537-540), so the accessor pair is silently converted
// into a static data property: the setter's side effects never run and the
// getter's derivation is dead. Solid 1.x invoked store setters.

describe("own accessor (get/set pair) on a store", () => {
  test("writing through the accessor invokes the setter", () => {
    const [state, setState] = createStore({
      _n: 1,
      get n(): number {
        return this._n;
      },
      set n(v: number) {
        this._n = v;
      }
    });
    setState(s => {
      s.n = 5;
    });
    flush();
    expect(state.n).toBe(5);
    // the setter must have run — backing field updated
    expect(state._n).toBe(5);
  });

  test("the getter stays live after a write through the accessor", () => {
    const [state, setState] = createStore({
      _n: 1,
      get n(): number {
        return this._n;
      },
      set n(v: number) {
        this._n = v;
      }
    });
    setState(s => {
      s.n = 5;
    });
    flush();
    // later writes to the backing field must still flow through the getter
    setState(s => {
      s._n = 9;
    });
    flush();
    expect(state._n).toBe(9);
    expect(state.n).toBe(9);
  });

  // Control: plain getters derived from other props do track writes to those
  // props (existing documented behavior).
  test("control: getter reflects backing-field writes when accessor untouched", () => {
    const [state, setState] = createStore({
      _n: 1,
      get n(): number {
        return this._n;
      }
    });
    setState(s => {
      s._n = 3;
    });
    flush();
    expect(state.n).toBe(3);
  });
});
