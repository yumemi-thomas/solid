// 1.x check for wave-2 store finding: writing through an own accessor (getter/setter pair)
import { describe, expect, test } from "vitest";
import { createStore } from "solid-js/store";

describe("1.x: store writes through an own accessor", () => {
  test("writing invokes the setter and the getter stays live", () => {
    const backing = { _n: 1 };
    const [state, setState] = createStore({
      get n() {
        return backing._n;
      },
      set n(v: number) {
        backing._n = v;
      }
    });
    expect(state.n).toBe(1);
    setState("n" as any, 5);
    console.log("[w2-acc] backing._n:", backing._n, "state.n:", state.n);
    expect(backing._n).toBe(5); // setter invoked?
    backing._n = 9;
    expect(state.n).toBe(9); // getter still live (not shadowed by a data override)?
  });
});
