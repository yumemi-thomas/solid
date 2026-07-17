import { describe, expect, it, vi } from "vitest";
import {
  createMemo,
  createOptimisticStore,
  createRoot,
  createStore,
  flush,
  refresh,
  untrack
} from "../src/index.js";
import { NotReadyError } from "../src/core/error.js";

const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/**
 * #2897: a derived store's seed is a draft for the derive function, never an
 * observable value. Until the firewall first resolves, ANY consumer read
 * throws NotReady (memo parity — returning the seed leaked it; returning
 * undefined would break non-nullable types). In dev strictRead scopes
 * (component bodies), the PENDING_ASYNC_UNTRACKED_READ error wins first,
 * exactly as it does for memos. Once initialized, untracked reads flow the
 * committed value; refetch windows keep the dev safeguard.
 */
describe("uninitialized derived stores never leak the seed (#2897)", () => {
  it("memo control: uninitialized async memo read in a component body throws the dev error", async () => {
    createRoot(() => {
      const a = createMemo(async () => {
        await wait(10);
        return 2;
      });
      flush();
      untrack(() => {
        expect(() => a()).toThrow("[PENDING_ASYNC_UNTRACKED_READ]");
      }, "App");
    });
    await wait(20);
    flush();
  });

  it("memo control: uninitialized async memo read in a plain untrack throws NotReady", async () => {
    createRoot(() => {
      const a = createMemo(async () => {
        await wait(10);
        return 2;
      });
      flush();
      let caught: any = null;
      try {
        untrack(() => a());
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(NotReadyError);
    });
    await wait(20);
    flush();
  });

  it("optimistic store: component-body read while uninitialized throws the dev error", async () => {
    createRoot(() => {
      const [s] = createOptimisticStore<{ a?: number }>(
        async () => {
          await wait(10);
          return {};
        },
        { a: 1 }
      );
      flush();
      untrack(() => {
        expect(() => s.a).toThrow("[PENDING_ASYNC_UNTRACKED_READ]");
      }, "App");
    });
    await wait(20);
    flush();
  });

  it("optimistic store: plain untracked read while uninitialized throws NotReady (prod path)", async () => {
    createRoot(() => {
      const [s] = createOptimisticStore<{ a?: number }>(
        async () => {
          await wait(10);
          return {};
        },
        { a: 1 }
      );
      flush();
      let caught: any = null;
      try {
        untrack(() => s.a);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(NotReadyError);
    });
    await wait(20);
    flush();
  });

  it("plain derived store: seed structure is invisible untracked ('in', keys, values)", async () => {
    createRoot(() => {
      const [s] = createStore<{ a?: number }>(
        async () => {
          await wait(10);
          return {};
        },
        { a: 1 }
      );
      flush();
      untrack(() => {
        expect(() => s.a).toThrow(NotReadyError);
        expect(() => "a" in s).toThrow(NotReadyError);
        expect(() => Object.keys(s)).toThrow(NotReadyError);
        expect(() => ({ ...s })).toThrow(NotReadyError);
      });
    });
    await wait(20);
    flush();
  });

  it("after first resolution, untracked reads flow the committed value", async () => {
    let read!: () => number | undefined;
    createRoot(() => {
      const [s] = createOptimisticStore<{ a?: number }>(
        async () => {
          await wait(5);
          return { a: 2 };
        },
        { a: 1 }
      );
      read = () => untrack(() => s.a);
    });
    flush();
    await wait(20);
    flush();
    expect(read()).toBe(2);
  });

  it("refetch window (initialized + pending): committed value untracked, dev error in component body", async () => {
    let s!: { a?: number };
    createRoot(() => {
      [s] = createOptimisticStore<{ a?: number }>(
        async () => {
          await wait(5);
          return { a: 2 };
        },
        { a: 1 }
      );
    });
    flush();
    await wait(20);
    flush();
    refresh(s as any);
    flush();
    // initialized: plain untracked read returns the committed value
    expect(untrack(() => s.a)).toBe(2);
    // but a component body still gets the loud dev safeguard
    untrack(() => {
      expect(() => s.a).toThrow("[PENDING_ASYNC_UNTRACKED_READ]");
    }, "App");
    await wait(20);
    flush();
    expect(untrack(() => s.a)).toBe(2);
  });

  it("plain (non-derived) store reads are unaffected", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    createRoot(() => {
      const [s] = createStore<{ a: number }>({ a: 1 });
      untrack(() => {
        expect(s.a).toBe(1);
        expect("a" in s).toBe(true);
        expect(Object.keys(s)).toEqual(["a"]);
      }, "App");
    });
    warn.mockRestore();
  });
});
