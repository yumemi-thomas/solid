import { describe, expect, test } from "vitest";
import { createStore, flush } from "../../src/index.js";

// Solid 2.0's isWrappable() includes any non-frozen object, and stores carry
// explicit custom-prototype support (STORE_CUSTOM_PROTO: method binding,
// inherited accessors). But built-ins whose state lives in internal slots
// (Map, Set, Date, ...) crash:
//
// 1. READ path: an inherited accessor (Map.prototype.size) is invoked via
//    `Reflect.get(storeValue, property, receiver)` with the *proxy* as
//    receiver (store.ts:544-549). Proxies don't forward internal slots, so
//    the getter throws "called on incompatible receiver".
//
// 2. WRITE path: inside a setter draft, the writeOnly get branch
//    (store.ts:551-561) returns prototype methods *unbound* (unlike the read
//    path at store.ts:568-579, which binds them to the raw value), so
//    `draft.m.set(...)` / `draft.d.setFullYear(...)` throw the same
//    incompatible-receiver TypeError.

describe("built-in exotic objects stored in stores", () => {
  test("Map.size read does not throw", () => {
    const [state] = createStore({ m: new Map([["a", 1]]) });
    expect(state.m.size).toBe(1);
  });

  test("Set.size read does not throw", () => {
    const [state] = createStore({ s: new Set([1, 2]) });
    expect(state.s.size).toBe(2);
  });

  test("Map.prototype.set works inside a setter draft", () => {
    const [state, setState] = createStore({ m: new Map([["a", 1]]) });
    setState(s => {
      s.m.set("b", 2);
    });
    flush();
    expect(state.m.get("b")).toBe(2);
  });

  test("Set.prototype.add works inside a setter draft", () => {
    const [state, setState] = createStore({ s: new Set([1]) });
    setState(s => {
      s.s.add(2);
    });
    flush();
    expect(state.s.has(2)).toBe(true);
  });

  test("Date mutator works inside a setter draft", () => {
    const [state, setState] = createStore({ d: new Date(2020, 0, 1) });
    setState(s => {
      s.d.setFullYear(2021);
    });
    flush();
    expect(state.d.getFullYear()).toBe(2021);
  });

  // Controls — the read path binds prototype methods, so these already work.
  test("control: Map.get read works", () => {
    const [state] = createStore({ m: new Map([["a", 1]]) });
    expect(state.m.get("a")).toBe(1);
  });

  test("control: Date.getTime read works", () => {
    const d = new Date(2020, 0, 1);
    const [state] = createStore({ d });
    expect(state.d.getTime()).toBe(d.getTime());
  });
});
