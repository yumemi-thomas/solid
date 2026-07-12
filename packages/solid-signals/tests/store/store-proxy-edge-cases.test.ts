import { afterEach, describe, expect, it } from "vitest";
import {
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  createStore,
  flush
} from "../../src/index.js";

afterEach(() => flush());

describe("store proxy edge cases", () => {
  describe("array length truncation", () => {
    // KNOWN BUG (2.0 audit): truncating an array via a returned shorter array (length
    // write) does not invalidate the truncated indices — the stale value remains
    // readable and `in` still reports presence. store/store.ts:542-601,717-719.
    // Remove .fails when fixed.
    it.fails("clears values and presence of truncated indices", () => {
      const [list, setList] = createStore([1, 2, 3]);
      setList(l => l.filter(x => x !== 3));
      flush();
      expect(list.length).toBe(2);
      expect(list[2]).toBeUndefined();
      expect(2 in list).toBe(false);
    });

    // KNOWN BUG (2.0 audit): Object.keys still enumerates truncated indices after a
    // length-shortening write. store/store.ts:542-601,717-719. Remove .fails when fixed.
    it.fails("drops truncated indices from Object.keys", () => {
      const [list, setList] = createStore([1, 2, 3]);
      setList(l => l.filter(x => x !== 3));
      flush();
      expect(Object.keys(list)).toEqual(["0", "1"]);
    });

    // KNOWN BUG (2.0 audit): effects tracking a truncated index are not rerun when the
    // array is shortened. store/store.ts:542-601,717-719. Remove .fails when fixed.
    it.fails("reruns effects tracking a truncated index", () => {
      const [list, setList] = createStore([1, 2, 3]);
      const seen: Array<number | undefined> = [];
      createRoot(() => {
        createRenderEffect(
          () => list[2],
          v => {
            seen.push(v);
          }
        );
      });
      flush();
      expect(seen).toEqual([3]);

      setList(l => l.filter(x => x !== 3));
      flush();
      expect(seen).toEqual([3, undefined]);
    });
  });

  describe("symbol-keyed writes", () => {
    // KNOWN BUG (2.0 audit): writing a symbol-keyed property on an array store throws
    // (parseInt on a symbol while computing the next array length). store/store.ts:563.
    // Remove .fails when fixed.
    it.fails("supports symbol-keyed writes on array stores", () => {
      const [list, setList] = createStore<any>([1, 2, 3]);
      const sym = Symbol.for("meta");
      expect(() =>
        setList((l: any) => {
          l[sym] = 42;
        })
      ).not.toThrow();
      // `Store<any>` is `Readonly<any>`, which TS won't let a symbol index, so cast.
      expect((list as any)[sym]).toBe(42);
    });
  });

  describe("non-configurable own properties", () => {
    // KNOWN BUG (2.0 audit): a non-configurable own property on the source object makes
    // Object.keys throw a proxy invariant violation. store/store.ts:683-703.
    // Remove .fails when fixed.
    it.fails("enumerates objects with non-configurable own properties", () => {
      const obj: any = {};
      Object.defineProperty(obj, "x", {
        value: 1,
        enumerable: true,
        writable: true,
        configurable: false
      });
      const [store] = createStore(obj);
      expect(Object.keys(store)).toEqual(["x"]);
      expect(store.x).toBe(1);
    });
  });

  describe("null-prototype objects", () => {
    // KNOWN BUG (2.0 audit): reading a function-valued property on a null-prototype
    // store crashes (unguarded hasOwnProperty call). store/store.ts:477.
    // Remove .fails when fixed.
    it.fails("reads function-valued properties on null-prototype stores", () => {
      const o: any = Object.create(null);
      o.fn = () => 1;
      const [store] = createStore(o);
      expect(store.fn).toBeTypeOf("function");
      expect(store.fn()).toBe(1);
    });
  });

  describe("optimistic store delete rollback", () => {
    // Pins that an optimistic delete reverts on flush, restoring both the value and
    // `in`/Object.keys presence.
    it("restores deleted properties and presence checks on rollback", () => {
      const [state, setState] = createOptimisticStore<{ a: number; b?: number }>({
        a: 1,
        b: 2
      });

      setState(s => {
        delete s.b;
      });
      expect(state.b).toBeUndefined();
      expect("b" in state).toBe(false);
      expect(Object.keys(state)).toEqual(["a"]);

      // Without an active transition, flush reverts the optimistic delete.
      flush();
      expect(state.b).toBe(2);
      expect("b" in state).toBe(true);
      expect(Object.keys(state)).toEqual(["a", "b"]);
    });
  });
});
