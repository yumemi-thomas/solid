/**
 * @vitest-environment jsdom
 */
// #2917: starting hydration for a second root while a first root still has a
// pending serialized <Loading> boundary must not reset the first root's
// pending-boundary bookkeeping. Pre-fix, every false→true transition of
// sharedConfig.hydrating zeroed the module-global _pendingBoundaries counter,
// so completing root B marked global hydration done while root A was still
// waiting — clearing snapshots out from under A and driving the counter
// negative when A finally resumed.
import { describe, expect, test, afterEach } from "vitest";
import { createRoot, flush } from "@solidjs/signals";
import { enableHydration, sharedConfig } from "../src/client/hydration.js";
import { Loading } from "../src/client/flow.js";

enableHydration();

// One persistent serialized-data config for the whole page, as installed by
// hydrate(): each root only toggles sharedConfig.hydrating around its own
// synchronous pass (root ids are disjoint, so the store is shared).
const hydrationData: Record<string, any> = {};
(sharedConfig as any).has = (id: string) => id in hydrationData;
(sharedConfig as any).load = (id: string) => hydrationData[id];
(sharedConfig as any).gather = () => {};

function startHydration(data: Record<string, any>) {
  Object.assign(hydrationData, data);
  sharedConfig.hydrating = true;
}

function stopHydration() {
  sharedConfig.hydrating = false;
}

const read = (value: any): any => {
  while (typeof value === "function") value = value();
  return value;
};

describe("multiple hydration roots (#2917)", () => {
  afterEach(() => {
    stopHydration();
  });

  test("completing a second root does not mark hydration done while the first root is pending", async () => {
    let resolveA!: () => void;
    const pendingA = new Promise<void>(resolve => {
      resolveA = resolve;
    });

    // Root A starts with an unresolved serialized Loading boundary.
    startHydration({ a0: pendingA });

    let resultA: any;
    createRoot(
      () => {
        resultA = Loading({
          fallback: "A loading" as any,
          get children() {
            return "A content" as any;
          }
        });
      },
      { id: "a" }
    );
    flush();
    stopHydration();

    expect(read(resultA)).toBe("A loading");
    expect(sharedConfig.done).toBe(false); // A is still pending

    // Root B starts and completes with no pending boundaries.
    startHydration({});

    let resultB: any;
    createRoot(
      () => {
        resultB = Loading({
          fallback: "B loading" as any,
          get children() {
            return "B content" as any;
          }
        });
      },
      { id: "b" }
    );
    flush();
    stopHydration();

    expect(read(resultB)).toBe("B content");

    // Pre-fix: true — B's completion drained hydration while A was pending.
    expect(sharedConfig.done).toBe(false);

    resolveA();
    await Promise.resolve();
    await Promise.resolve();
    flush();

    expect(read(resultA)).toBe("A content");
    expect(sharedConfig.done).toBe(true);
  });

  test("disposing a pending root releases its boundary count instead of holding hydration open", async () => {
    // Never resolves — the boundary can only release through disposal.
    const pendingC = new Promise<void>(() => {});
    startHydration({ c0: pendingC });

    let dispose!: () => void;
    createRoot(
      d => {
        dispose = d;
        Loading({
          fallback: "C loading" as any,
          get children() {
            return "C content" as any;
          }
        });
      },
      { id: "c" }
    );
    flush();
    stopHydration();

    expect(sharedConfig.done).toBe(false);

    dispose();
    flush();

    expect(sharedConfig.done).toBe(true);

    // A late settle of the abandoned promise must not double-release
    // (pre-#2917 the counter went negative here).
    await Promise.resolve();
    await Promise.resolve();
    flush();
    expect(sharedConfig.done).toBe(true);
  });
});
