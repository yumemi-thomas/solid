import { describe, expect, test } from "vitest";
import { createEffect, createRoot, createStore, flush, reconcile } from "../../src/index.js";

// reconcile() decides "merge in place" vs "replace + notify" by diffing own
// enumerable keys (applyStateFast/applyStateSlow values branch,
// reconcile.ts:273-295 / 426-447). Objects whose state lives in internal
// slots — Date, Map, Set, RegExp — have *no* own enumerable keys, and both
// old and new values are wrappable, so reconcile recurses into them
// (reconcile.ts:293), swaps STORE_VALUE, finds zero keys to diff, and never
// calls setSignal/notifySelf. The store's raw value silently updates but no
// subscriber is ever notified: classic "server payload has a new updatedAt
// but the UI never re-renders".
//
// (Solid 1.x treated these as leaf values — prev !== next → replace+notify.)

describe("reconcile with internal-slot leaf values", () => {
  test("Date value change notifies subscribers", () => {
    const [state, setState] = createStore({ updatedAt: new Date(2020, 0, 1), n: 1 });
    const seen: number[] = [];
    createRoot(() => {
      createEffect(
        () => state.updatedAt.getTime(),
        v => {
          seen.push(v);
        }
      );
    });
    flush();
    expect(seen.length).toBe(1);
    setState(reconcile({ updatedAt: new Date(2021, 5, 5), n: 1 }, "id"));
    flush();
    // raw value did update...
    expect(state.updatedAt.getFullYear()).toBe(2021);
    // ...so the tracked read must have been re-run
    expect(seen.length).toBe(2);
    expect(new Date(seen[1]).getFullYear()).toBe(2021);
  });

  test("Map value change notifies subscribers", () => {
    const [state, setState] = createStore({ m: new Map([["a", 1]]) });
    const seen: Array<Map<string, number>> = [];
    createRoot(() => {
      createEffect(
        () => state.m,
        v => {
          seen.push(v as any);
        }
      );
    });
    flush();
    expect(seen.length).toBe(1);
    setState(reconcile({ m: new Map([["a", 2]]) }, "id"));
    flush();
    expect(seen.length).toBe(2);
  });

  // Control: a plain draft write of a new Date notifies fine — only the
  // reconcile path is broken.
  test("control: plain set of a new Date notifies", () => {
    const [state, setState] = createStore({ d: new Date(2020, 0, 1) });
    const seen: number[] = [];
    createRoot(() => {
      createEffect(
        () => state.d.getTime(),
        v => {
          seen.push(v);
        }
      );
    });
    flush();
    setState(s => {
      s.d = new Date(2021, 0, 1) as any;
    });
    flush();
    expect(seen.length).toBe(2);
  });
});
