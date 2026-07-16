import { describe, expect, it, vi } from "vitest";
import {
  createMemo,
  createOptimisticStore,
  createRoot,
  createStore,
  flush,
  untrack
} from "../src/index.js";

const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// Component bodies run under untrack(fn, componentName), which arms the
// strictRead dev safeguards. A derived store whose firewall is in flight must
// hit the same PENDING_ASYNC_UNTRACKED_READ error a pending memo does (#2897)
// — before the fix it silently returned the seed value with only the
// STRICT_READ_UNTRACKED warning.
describe("strictRead safeguard parity for derived stores (#2897)", () => {
  it("memo control: pending async memo read in a component body throws", async () => {
    createRoot(() => {
      const a = createMemo(async () => {
        await wait(10);
        return 2;
      });
      untrack(() => {
        expect(() => a()).toThrow("[PENDING_ASYNC_UNTRACKED_READ]");
      }, "App");
    });
    flush();
    await wait(20);
    flush();
  });

  it("derived optimistic store with a seed: in-flight read in a component body throws", async () => {
    createRoot(() => {
      const [s] = createOptimisticStore<{ a?: number }>(
        async () => {
          await wait(10);
          return {};
        },
        { a: 1 }
      );
      untrack(() => {
        expect(() => s.a).toThrow("[PENDING_ASYNC_UNTRACKED_READ]");
      }, "App");
    });
    flush();
    await wait(20);
    flush();
  });

  it("derived plain store with a seed: in-flight read in a component body throws", async () => {
    createRoot(() => {
      const [s] = createStore<{ a?: number }>(
        async () => {
          await wait(10);
          return {};
        },
        { a: 1 }
      );
      untrack(() => {
        expect(() => s.a).toThrow("[PENDING_ASYNC_UNTRACKED_READ]");
      }, "App");
    });
    flush();
    await wait(20);
    flush();
  });

  it("settled derived store read in a component body keeps the plain strict-read warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let read!: () => number | undefined;
    createRoot(() => {
      const [s] = createOptimisticStore<{ a?: number }>(
        async () => {
          await wait(5);
          return { a: 2 };
        },
        { a: 1 }
      );
      read = () => untrack(() => s.a, "App");
    });
    flush();
    await wait(20);
    flush();
    expect(read()).toBe(2); // settled: value flows, no throw
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[STRICT_READ_UNTRACKED]"));
    warn.mockRestore();
  });

  it("plain (non-derived) store read in a component body is unaffected", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    createRoot(() => {
      const [s] = createStore<{ a: number }>({ a: 1 });
      untrack(() => {
        expect(s.a).toBe(1);
      }, "App");
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[STRICT_READ_UNTRACKED]"));
    warn.mockRestore();
  });
});
