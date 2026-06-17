import { vi } from "vitest";
import {
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  setTransitionCommitWrapper,
  startTransition
} from "../src/index.js";

afterEach(() => {
  setTransitionCommitWrapper(null);
  flush();
});

describe("startTransition", () => {
  it("runs a synchronous change as a transition and commits it", () => {
    const [count, setCount] = createSignal(0);
    let seen = -1;
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      createRenderEffect(
        () => count(),
        v => {
          seen = v;
        }
      );
      flush();
    });
    expect(seen).toBe(0);

    // Outside the root's synchronous scope, so the write is allowed.
    const r = startTransition(() => setCount(5));
    expect(r).toBe(5); // sync scope returns the scope's value
    expect(seen).toBe(5);
    dispose();
  });

  it("returns a promise for an async scope and commits after it settles", async () => {
    const [count, setCount] = createSignal(0);
    let seen = 0;
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      createRenderEffect(
        () => count(),
        v => {
          seen = v;
        }
      );
      flush();
    });

    let release!: () => void;
    const gate = new Promise<void>(r => (release = r));
    const p = startTransition(async () => {
      setCount(7);
      await gate;
    });
    expect(typeof (p as Promise<void>).then).toBe("function");

    // Held open while the scope is pending.
    await Promise.resolve();
    expect(seen).toBe(0);

    release();
    await p;
    flush();
    expect(seen).toBe(7);
    dispose();
  });

  // Regression: a transition commit handed to a (deferred) commit wrapper that
  // runs its mutations synchronously — like Chromium invoking the view-transition
  // update callback inline — can reveal content whose async read re-enters the
  // scheduler while the wrapper still holds the queue (`_running`). That used to
  // spin the top-level flush() drain loop forever ("Potential Infinite Loop
  // Detected"); the drain must yield instead.
  it("does not spin flush() when a deferred commit reveals async content", () => {
    setTransitionCommitWrapper(apply => {
      apply(); // run mutations inline...
      return Promise.resolve(); // ...but report the commit as async (holds _running)
    });

    const [show, setShow] = createSignal(false);
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      // Stays pending forever — reading it while shown re-schedules during commit.
      const asyncMemo = createMemo(() => new Promise<number>(() => {}));
      createRenderEffect(
        () => (show() ? asyncMemo() : 0),
        () => {}
      );
      flush();
    });

    expect(() => startTransition(() => setShow(true))).not.toThrow();
    dispose();
  });

  // The async-scope footgun (#1): writes after an `await` aren't in the
  // transition. We can't capture them, but we make the silent failure loud.
  it("warns (dev) when a write lands after an await inside an async startTransition", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const [count, setCount] = createSignal(0);
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      createRenderEffect(
        () => count(),
        () => {}
      );
      flush();
    });

    let release!: () => void;
    const gate = new Promise<void>(r => (release = r));
    const p = startTransition(async () => {
      setCount(1); // pre-await: ends the transition's synchronous window
      await gate;
      setCount(9); // post-await: NOT part of the transition → should warn
    });
    release();
    await p;
    flush();

    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls.some(c => String(c[0]).includes("after an `await`"))).toBe(true);
    warn.mockRestore();
    dispose();
  });
});
