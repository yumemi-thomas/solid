import { afterEach, describe, expect, it } from "vitest";
import { createRenderEffect, createRoot, createStore, flush, reconcile } from "../../src/index.js";

afterEach(() => flush());

describe("reconcile edge cases", () => {
  describe("keyed arrays with null entries", () => {
    // KNOWN BUG (2.0 audit): keyed reconcile crashes on null entries in the array.
    // store/reconcile.ts:66-73,131-137. Remove .fails when fixed.
    it.fails("preserves null entries and updates keyed items around them", () => {
      const [list, setList] = createStore<any[]>([{ id: 1 }, null, { id: 2 }]);
      expect(() => setList(reconcile([{ id: 1 }, null, { id: 2, v: 5 }], "id"))).not.toThrow();
      expect(list[0]).toEqual({ id: 1 });
      expect(list[1]).toBe(null);
      expect(list[2]).toEqual({ id: 2, v: 5 });
    });
  });

  describe("non-keyed object to primitive element", () => {
    // KNOWN BUG (2.0 audit): non-keyed reconcile of an object element to a primitive
    // throws "Invalid value used as weak map key". store/reconcile.ts:140-147.
    // Remove .fails when fixed.
    it.fails("replaces an object element with a primitive", () => {
      const [list, setList] = createStore<any[]>([{ a: 1 }]);
      expect(() => setList(reconcile([5], "id"))).not.toThrow();
      expect(list[0]).toBe(5);
      expect(list.length).toBe(1);
    });
  });

  describe("array removal notifications", () => {
    // KNOWN BUG (2.0 audit): pure trailing removal in a keyed array does not notify
    // $TRACK/keys subscribers (Object.keys effects never rerun). store/reconcile.ts:89-107.
    // Remove .fails when fixed.
    it.fails("notifies key tracking on pure trailing removal", () => {
      const [list, setList] = createStore([{ id: 1 }, { id: 2 }, { id: 3 }]);
      let keys: string[] = [];
      let runs = 0;
      createRoot(() => {
        createRenderEffect(
          () => Object.keys(list),
          k => {
            runs++;
            keys = k;
          }
        );
      });
      flush();
      expect(runs).toBe(1);
      expect(keys).toEqual(["0", "1", "2"]);

      setList(reconcile([{ id: 1 }, { id: 2 }], "id"));
      flush();
      expect(runs).toBe(2);
      expect(keys).toEqual(["0", "1"]);
    });

    // Pins the working counterpart of the trailing-removal bug above.
    it("notifies key tracking on mid-array removal", () => {
      const [list, setList] = createStore([{ id: 1 }, { id: 2 }, { id: 3 }]);
      let keys: string[] = [];
      let runs = 0;
      createRoot(() => {
        createRenderEffect(
          () => Object.keys(list),
          k => {
            runs++;
            keys = k;
          }
        );
      });
      flush();
      expect(runs).toBe(1);
      expect(keys).toEqual(["0", "1", "2"]);

      setList(reconcile([{ id: 1 }, { id: 3 }], "id"));
      flush();
      expect(runs).toBe(2);
      expect(keys).toEqual(["0", "1"]);
    });
  });

  describe("array/object type swaps", () => {
    // KNOWN BUG (2.0 audit): when the property has been read under tracking (STORE_NODE
    // exists), reconciling an array value to a plain object corrupts the wrapped proxy:
    // Array.isArray stays true and Object.keys throws an ownKeys invariant error.
    // store/reconcile.ts:169-177. Remove .fails when fixed.
    it.fails("swaps an array value to an object under tracking", () => {
      const [store, setStore] = createStore<{ value: any }>({ value: [1, 2] });
      createRoot(() => {
        createRenderEffect(
          () => store.value,
          () => {}
        );
      });
      flush();

      setStore(reconcile({ value: { a: 1 } }, "id"));
      flush();
      expect(Array.isArray(store.value)).toBe(false);
      expect(Object.keys(store.value)).toEqual(["a"]);
      expect(store.value.a).toBe(1);
    });
  });

  describe("circular references", () => {
    // Pins that reconciling circular structures (a -> b -> a) terminates and applies
    // updates correctly, including when tracked nodes force deep recursion.
    it("terminates and applies updates through circular references", () => {
      const a: any = { id: 1, name: "a" };
      const b: any = { id: 2, name: "b" };
      a.other = b;
      b.other = a;

      const [state, setState] = createStore<{ root: any }>({ root: a });
      let seen = "";
      createRoot(() => {
        createRenderEffect(
          () => `${state.root.name}|${state.root.other.name}|${state.root.other.other.name}`,
          v => {
            seen = v;
          }
        );
      });
      flush();
      expect(seen).toBe("a|b|a");

      const a2: any = { id: 1, name: "a2" };
      const b2: any = { id: 2, name: "b2" };
      a2.other = b2;
      b2.other = a2;

      setState(reconcile({ root: a2 }, "id"));
      flush();
      expect(seen).toBe("a2|b2|a2");
      expect(state.root.name).toBe("a2");
      expect(state.root.other.name).toBe("b2");
      expect(state.root.other.other.name).toBe("a2");
    });
  });
});
