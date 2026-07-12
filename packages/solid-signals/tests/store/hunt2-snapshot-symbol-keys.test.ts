import { describe, expect, test } from "vitest";
import { createStore, flush, snapshot } from "../../src/index.js";

// #2769 made stores support symbol-keyed properties (ownEnumerableKeys in
// storeSetter/merge/omit, symbol-safe set trap). But getKeys()
// (store.ts:332-352) still seeds its base key list from Object.keys(source),
// which drops symbol keys. getKeys drives both:
//   - snapshotImpl (utils.ts:95) — so snapshot()/deep() silently drop
//     symbol-keyed props as soon as the object has a STORE_OVERRIDE (i.e.
//     after any write to it; before a write the original identity is
//     returned and symbols survive by accident), and
//   - unwrapStoreValue (store.ts:186) — so writing a previously-written
//     store subtree into another store (or another part of the same store)
//     silently drops its symbol-keyed props.

describe("symbol-keyed props survive snapshot/unwrap after writes", () => {
  const sym = Symbol("meta");

  test("control: snapshot before any write keeps symbol keys", () => {
    const [state] = createStore({ a: 1, [sym]: "keep" } as any);
    const snap = snapshot(state) as any;
    expect(snap[sym]).toBe("keep");
  });

  test("snapshot after a write keeps symbol keys", () => {
    const [state, setState] = createStore({ a: 1, [sym]: "keep" } as any);
    setState(s => {
      s.a = 2;
    });
    flush();
    const snap = snapshot(state) as any;
    expect(snap.a).toBe(2);
    expect(snap[sym]).toBe("keep");
  });

  test("writing a written store subtree into another store keeps symbol keys", () => {
    const [a, setA] = createStore({ inner: { x: 1, [sym]: "keep" } as any });
    setA(s => {
      s.inner.x = 2;
    });
    flush();
    const [b, setB] = createStore<any>({});
    setB(s => {
      s.copied = a.inner;
    });
    flush();
    expect(b.copied.x).toBe(2);
    expect(b.copied[sym]).toBe("keep");
  });
});
