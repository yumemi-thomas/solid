// 1.x check for wave-2 store finding: unwrap/snapshot keeps symbol keys after a write
import { describe, expect, test } from "vitest";
import { createStore, unwrap } from "solid-js/store";

const sym = Symbol("meta");

describe("1.x: unwrap keeps symbol keys after writes", () => {
  test("unwrap after a write keeps symbol keys", () => {
    const [state, setState] = createStore<any>({ [sym]: "keep", a: 1 });
    setState("a", 2);
    const raw = unwrap(state);
    console.log("[w2-sym] raw[sym]:", raw[sym], "raw.a:", raw.a);
    expect(raw.a).toBe(2);
    expect(raw[sym]).toBe("keep");
  });

  test("writing a written store subtree into another store keeps symbol keys", () => {
    const [a, setA] = createStore<any>({ inner: { [sym]: "keep", n: 1 } });
    setA("inner", "n", 2);
    const [b, setB] = createStore<any>({ copied: null });
    setB("copied", a.inner);
    console.log("[w2-sym] b.copied[sym]:", b.copied[sym]);
    expect(b.copied.n).toBe(2);
    expect(b.copied[sym]).toBe("keep");
  });
});
