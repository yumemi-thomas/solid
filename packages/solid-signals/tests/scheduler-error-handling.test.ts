import { createEffect, createRoot, createSignal, flush } from "../src/index.js";

afterEach(() => {
  vi.unstubAllGlobals();
  flush();
});

describe("scheduler error handling", () => {
  // KNOWN BUG (2.0 audit): scheduler stall after a user effect writes a signal and then
  // throws during the microtask flush. `scheduled` is left true with no microtask queued
  // (schedule() early-returns at src/core/scheduler.ts:221-225; flush() at
  // src/core/scheduler.ts:655-680 lets the throw escape the drain loop), so every
  // subsequent write early-returns and reactivity is dead until a manual flush().
  // Remove .fails when fixed.
  it.fails("reschedules a microtask after a user effect writes then throws during flush", () => {
    const tasks: Array<() => void> = [];
    vi.stubGlobal("queueMicrotask", (fn: () => void) => {
      tasks.push(fn);
    });

    const [$a, setA] = createSignal(0);
    const [$b, setB] = createSignal(0);
    const observer = vi.fn();

    createRoot(() => {
      createEffect($a, v => {
        if (v === 1) {
          setB(100);
          throw new Error("boom");
        }
      });
      createEffect($b, observer);
    });

    // Drain the initial run manually and discard any microtasks captured so far.
    flush();
    tasks.length = 0;
    expect(observer).toHaveBeenCalledTimes(1);

    setA(1);
    expect(tasks.length).toBe(1);

    // Simulate the microtask tick: the throwing effect escapes the flush.
    const tick = tasks.shift()!;
    expect(() => tick()).toThrow("boom");

    // A subsequent write must schedule a NEW microtask so reactivity recovers.
    setB(7);
    expect(tasks.length).toBe(1); // BUG: stays 0 today — schedule() early-returns
    tasks.shift()!();
    expect(observer.mock.lastCall?.[0]).toBe(7);
  });

  // KNOWN BUG (2.0 audit): when one effect throws during flush, later-enqueued effects in
  // the same batch never run — Queue.run detaches the queue array before running it
  // (src/core/scheduler.ts:259-263), and runQueue (src/core/scheduler.ts:682-684) lets the
  // throw drop the remaining callbacks. Remove .fails when fixed.
  it.fails("still runs sibling effects in the same batch when an earlier effect throws", () => {
    const [$a, setA] = createSignal(0);
    const second = vi.fn();

    createRoot(() => {
      createEffect($a, v => {
        if (v === 1) throw new Error("boom");
      });
      createEffect($a, second);
    });

    flush();
    expect(second).toHaveBeenCalledTimes(1);

    setA(1);
    expect(() => flush()).toThrow("boom");

    // Even an explicit extra drain cannot recover the dropped sibling today.
    flush();
    expect(second).toHaveBeenCalledWith(1, 0);
  });

  // PIN: recovery via manual flush. After a throwing flush that the user catches, a manual
  // flush() drains the writes made by the throwing effect, and a new write + flush works.
  it("recovers via manual flush after a throwing flush", () => {
    const [$a, setA] = createSignal(0);
    const [$b, setB] = createSignal(0);
    const observer = vi.fn();

    createRoot(() => {
      createEffect($a, v => {
        if (v === 1) {
          setB(100);
          throw new Error("boom");
        }
      });
      createEffect($b, observer);
    });

    flush();
    expect(observer).toHaveBeenCalledTimes(1);

    setA(1);
    expect(() => flush()).toThrow("boom");

    // Manual flush drains the write made inside the throwing effect.
    flush();
    expect(observer.mock.lastCall?.[0]).toBe(100);

    // And a fresh write + manual flush still works.
    setB(7);
    flush();
    expect(observer.mock.lastCall?.[0]).toBe(7);
  });

  // PIN: a pending write must not run effects whose root was disposed before the flush.
  it("does not run an effect after its root is disposed, even with a pending write", () => {
    const [$x, setX] = createSignal(0);
    const effect = vi.fn();

    const dispose = createRoot(d => {
      createEffect($x, effect);
      return d;
    });

    flush();
    expect(effect).toHaveBeenCalledTimes(1);

    setX(1);
    dispose();
    flush();
    expect(effect).toHaveBeenCalledTimes(1);
  });

  // PIN: a cleanup returned from the effect callback runs before each rerun and on dispose.
  it("runs the cleanup returned by an effect callback on rerun and on dispose", () => {
    const cleanup = vi.fn();
    const [$x, setX] = createSignal(0);

    const dispose = createRoot(d => {
      createEffect($x, () => cleanup);
      return d;
    });

    flush();
    expect(cleanup).not.toHaveBeenCalled();

    setX(1);
    flush();
    expect(cleanup).toHaveBeenCalledTimes(1);

    dispose();
    expect(cleanup).toHaveBeenCalledTimes(2);
  });
});
