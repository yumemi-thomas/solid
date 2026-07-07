import {
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  createStore,
  flush,
  isPending,
  latest
} from "../src/index.js";

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * isPending()'s companion signal is written optimistically, so an ambient
 * transition completing used to revert its `true` override while the async it
 * reports on was still in flight. The revert re-notified the subscribed
 * effect, which re-armed the write: an infinite flush loop ("Potential
 * Infinite Loop Detected" in dev, an unbounded spin in prod), during which
 * isPending never read `true`. resolveOptimisticNodes now defers reverting a
 * companion while its resolved source (parent/firewall for latest() shadows)
 * is still in-flight.
 */
describe("isPending companion retention across transitions", () => {
  function watchPending(read: () => boolean) {
    const seen: boolean[] = [];
    createRoot(() => {
      createEffect(read, v => {
        seen.push(v);
      });
    });
    return seen;
  }

  function trackUncaught() {
    const errors: string[] = [];
    const handler = (e: Error) => {
      errors.push(String(e));
    };
    process.on("uncaughtException", handler);
    return {
      errors,
      done: () => {
        try {
          flush();
        } catch (e) {
          errors.push(String(e));
        } finally {
          process.off("uncaughtException", handler);
        }
      }
    };
  }

  it("isPending(() => latest(x)) in a user effect survives a post-settle refetch without looping", async () => {
    const guard = trackUncaught();
    const [version, refetch] = createSignal(0);
    const data = createMemo(async () => {
      const v = version();
      await wait(20);
      return `v${v}`;
    });
    const seen = watchPending(() => isPending(() => latest(data)));

    await wait(60); // initial load settles
    refetch(1); // the write that used to spin the scheduler
    await wait(10); // mid-flight
    expect(seen.at(-1)).toBe(true); // pending is observable
    await wait(60); // refetch settles
    guard.done();

    expect(seen.at(-1)).toBe(false); // and clears
    expect(guard.errors).toEqual([]); // no "Potential Infinite Loop Detected."
  });

  it("control: isPending(x) directly never looped and still works", async () => {
    const guard = trackUncaught();
    const [version, refetch] = createSignal(0);
    const data = createMemo(async () => {
      const v = version();
      await wait(20);
      return `v${v}`;
    });
    const seen = watchPending(() => isPending(data));

    await wait(60);
    refetch(1);
    await wait(60);
    guard.done();

    expect(seen.at(-1)).toBe(false);
    expect(guard.errors).toEqual([]);
  });

  it("shared update: pending remains observable until the transition commits", async () => {
    // UI timing is pinned in @solidjs/web's latest-async test.
    const guard = trackUncaught();
    const [version, refetch] = createSignal(0);
    const fast = createMemo(async () => {
      const v = version();
      await wait(15);
      return `fast v${v}`;
    });
    const slow = createMemo(async () => {
      const v = version();
      await wait(120);
      return `slow v${v}`;
    });
    const seenFast = watchPending(() => isPending(() => latest(fast)));
    const seenSlow = watchPending(() => isPending(() => latest(slow)));

    await wait(200); // both settle
    refetch(1);
    await wait(300); // transition fully commits
    guard.done();

    expect(seenFast).toContain(true); // pending was observable
    expect(seenSlow).toContain(true);
    expect(seenFast.at(-1)).toBe(false); // and settles false
    expect(seenSlow.at(-1)).toBe(false);
    expect(guard.errors).toEqual([]); // no "Potential Infinite Loop Detected."
  });

  it("companion survives an unrelated signal write flushing mid-flight", async () => {
    const guard = trackUncaught();
    const [version, refetch] = createSignal(0);
    const [unrelated, setUnrelated] = createSignal(0);
    const data = createMemo(async () => {
      const v = version();
      await wait(50);
      return `v${v}`;
    });
    const seen = watchPending(() => isPending(() => latest(data)));
    createRoot(() => {
      createEffect(unrelated, () => {});
    });

    await wait(100); // settle
    refetch(1); // go pending
    await wait(10);
    setUnrelated(1); // unrelated flush completes while data is in flight
    await wait(10);
    expect(seen.at(-1)).toBe(true); // companion kept its override
    await wait(100);
    guard.done();

    expect(seen.at(-1)).toBe(false);
    expect(guard.errors).toEqual([]);
  });

  it("store-leaf shape: isPending(() => latest(() => store.value)) survives a refetch", async () => {
    const guard = trackUncaught();
    const [version, refetch] = createSignal(0);
    const [store] = createStore(
      async () => {
        const v = version();
        await wait(20);
        return { value: `v${v}` };
      },
      {} as { value?: string }
    );
    const seen = watchPending(() => isPending(() => latest(() => store.value)));

    await wait(60);
    refetch(1);
    await wait(60);
    guard.done();

    expect(seen.at(-1)).toBe(false);
    expect(guard.errors).toEqual([]); // was: "Potential Infinite Loop Detected."
  });

  it("two watchers of the same source survive a refetch", async () => {
    const guard = trackUncaught();
    const [version, refetch] = createSignal(0);
    const data = createMemo(async () => {
      const v = version();
      await wait(20);
      return `v${v}`;
    });
    const a = watchPending(() => isPending(() => latest(data)));
    const b = watchPending(() => isPending(() => latest(data)));

    await wait(60);
    refetch(1);
    await wait(60);
    guard.done();

    expect(a.at(-1)).toBe(false);
    expect(b.at(-1)).toBe(false);
    expect(guard.errors).toEqual([]); // was: "Potential Infinite Loop Detected."
  });

  it("safety net: a source disposed mid-flight reverts the companion to false", async () => {
    const guard = trackUncaught();
    const [version, refetch] = createSignal(0);
    let dispose!: () => void;
    let data!: () => string;
    createRoot(d => {
      dispose = d;
      data = createMemo(async () => {
        const v = version();
        await wait(50);
        return `v${v}`;
      });
    });
    // the watcher outlives the source's root
    const seen = watchPending(() => isPending(() => latest(data)));
    const [unrelated, setUnrelated] = createSignal(0);
    createRoot(() => {
      createEffect(unrelated, () => {});
    });

    await wait(100); // settle
    refetch(1); // go pending
    await wait(10);
    expect(seen.at(-1)).toBe(true);
    dispose(); // source disposed while its async is in flight
    setUnrelated(1); // provoke a flush so the parked companion is re-examined
    await wait(100);
    guard.done();

    // the companion must not stay latched true after the source is gone
    expect(seen.at(-1)).toBe(false);
    expect(guard.errors).toEqual([]);
  });
});
