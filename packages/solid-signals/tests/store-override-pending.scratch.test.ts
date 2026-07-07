import { describe, it } from "vitest";
import {
  action,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending
} from "../src/index.js";
import { createOptimisticStore } from "../src/store/index.js";

describe("probe: derived optimistic store, override held by an action, projection idle", () => {
  it("during the yield: what does isPending report?", async () => {
    const [$id] = createSignal(1);
    let state!: { data: number };
    let setState!: (fn: (s: { data: number }) => void) => void;
    let resolveAction!: () => void;
    let increment!: () => Promise<void>;

    createRoot(() => {
      [state, setState] = createOptimisticStore(
        async (s: { data: number }) => {
          const id = $id();
          await Promise.resolve();
          s.data = id * 10;
        },
        { data: 0 }
      );
      createRenderEffect(
        () => state.data,
        () => {}
      );
      increment = action(function* () {
        setState(s => {
          s.data = 999;
        });
        yield new Promise<void>(r => (resolveAction = r));
      });
    });

    flush();
    await new Promise(r => setTimeout(r, 0));
    console.log("initial: data=", state.data, "isPending=", isPending(() => state.data));

    const p = increment();
    flush();
    // Projection is idle here — no source changed, no refetch in flight.
    console.log(
      "override held by action (projection idle): data=",
      state.data,
      "isPending=",
      isPending(() => state.data)
    );

    resolveAction();
    await p;
    await Promise.resolve();
    flush();
    console.log("action done: data=", state.data, "isPending=", isPending(() => state.data));
  });
});
