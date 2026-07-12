// 1.x check for wave-2 store finding: Object.freeze(store) poisoning
import { describe, expect, test } from "vitest";
import { createRoot, createRenderEffect } from "solid-js";
import { createStore } from "solid-js/store";

describe("1.x: Object.freeze on a store proxy", () => {
  test("freeze attempt does not poison later enumeration/reads/writes", () => {
    const [state, setState] = createStore<any>({ v: 1, o: { n: 1 } });
    let frozeThrew: any = null;
    try {
      Object.freeze(state);
    } catch (e) {
      frozeThrew = e;
    }
    let keys: any = null;
    let keysThrew: any = null;
    try {
      keys = Object.keys(state);
    } catch (e) {
      keysThrew = e;
    }
    const seen: number[] = [];
    const dispose = createRoot(d => {
      createRenderEffect(() => seen.push(state.v));
      return d;
    });
    let writeThrew: any = null;
    try {
      setState("v", 2);
    } catch (e) {
      writeThrew = e;
    }
    console.log(
      "[w2-freeze] freezeThrew:",
      String(frozeThrew),
      "| keys:",
      keys,
      "keysThrew:",
      String(keysThrew),
      "| writeThrew:",
      String(writeThrew),
      "| seen:",
      seen
    );
    expect(keysThrew).toBeNull(); // enumeration must not be poisoned
    dispose();
  });
});
