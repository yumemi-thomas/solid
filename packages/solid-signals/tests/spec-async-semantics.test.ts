/**
 * SPEC TESTS — see packages/solid-signals/SPEC-ASYNC-SEMANTICS.md.
 *
 * These pin *ruled* semantics (Tier A). Changing an expectation here requires
 * a design decision recorded in the spec document — never "update
 * expectations" to make an implementation change pass.
 *
 * Verdicts pinned in this file (maintainer, 2026-07-06): B1, B2, B3, B5 —
 * promoted to A13–A16.
 */
import { describe, expect, it } from "vitest";
import {
  createLoadingBoundary,
  createMemo,
  createOptimistic,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  latest,
  refresh,
  type SourceAccessor
} from "../src/index.js";

function deferredFetcher<T>(compute: (arg: number) => T) {
  const resolvers: Array<(v: T) => void> = [];
  return {
    fetch(arg: number): Promise<T> {
      return new Promise<T>(r => resolvers.push(() => r(compute(arg))));
    },
    resolveAll(): void {
      const pending = resolvers.splice(0);
      for (const r of pending) r(undefined as never);
    }
  };
}

const settle = async () => {
  // Two microtask turns: promise resolution + async-write propagation.
  await Promise.resolve();
  await Promise.resolve();
  flush();
};

describe("A13 (was B1): resting optimistic node ≡ plain async memo", () => {
  // A createOptimistic node with no active override must be observationally
  // identical to a plain async memo: same values, same isPending/latest
  // verdicts, at every checkpoint of a refetch cycle — both before any
  // override was ever written and after a full override cycle reverted.
  it("matches a plain async memo through initial load and refresh, before and after an override cycle", async () => {
    const [tick, setTick] = createSignal(1);
    const plainFetch = deferredFetcher((t: number) => t * 10);
    const optFetch = deferredFetcher((t: number) => t * 10);

    let plain!: SourceAccessor<number>;
    let opt!: SourceAccessor<number>;
    let setOpt!: (v: number) => void;

    createRoot(() => {
      plain = createMemo(() => plainFetch.fetch(tick()));
      [opt, setOpt] = createOptimistic(() => optFetch.fetch(tick()));
      createRenderEffect(plain, () => {});
      createRenderEffect(opt, () => {});
    });
    flush();

    const observe = () => ({
      plain: [latest(plain), isPending(plain)],
      opt: [latest(opt), isPending(opt)]
    });
    const expectEquivalent = () => {
      const o = observe();
      expect(o.opt).toEqual(o.plain);
    };

    // Initial load resolves.
    plainFetch.resolveAll();
    optFetch.resolveAll();
    await settle();
    expect(plain()).toBe(10);
    expect(opt()).toBe(10);
    expectEquivalent();

    // Refetch via source change: both report pending with the stale value.
    setTick(2);
    flush();
    expectEquivalent();
    expect(isPending(opt)).toBe(true);

    plainFetch.resolveAll();
    optFetch.resolveAll();
    await settle();
    expect(opt()).toBe(20);
    expectEquivalent();

    // Full override cycle on the optimistic node: write, resolve, revert.
    setTick(3);
    setOpt(30);
    flush();
    expect(opt()).toBe(30); // override visible immediately
    plainFetch.resolveAll();
    optFetch.resolveAll();
    await settle();
    expect(opt()).toBe(30);
    expect(plain()).toBe(30);

    // Now *resting* again — must still behave exactly like the plain memo.
    expectEquivalent();
    expect(isPending(opt)).toBe(false);

    refresh(opt);
    refresh(plain);
    flush();
    expectEquivalent();
    expect(isPending(opt)).toBe(true); // stale value shown while refetching

    plainFetch.resolveAll();
    optFetch.resolveAll();
    await settle();
    expect(opt()).toBe(30);
    expectEquivalent();
    expect(isPending(opt)).toBe(false);
  });
});

describe("A14 (was B2): companion lanes flush independently of the owner's async", () => {
  // The isPending()/latest() companion nodes get child lanes that do NOT merge
  // with the owner's lane: an isPending effect (spinner) must fire while the
  // owner's async is still in flight, not after it settles.
  it("isPending effect fires true before the owner's async resolves", async () => {
    const [id, setId] = createSignal(1);
    const fetcher = deferredFetcher((t: number) => t * 10);
    const pendingLog: boolean[] = [];
    const valueLog: number[] = [];

    let data!: SourceAccessor<number>;
    let setData!: (v: number) => void;
    createRoot(() => {
      [data, setData] = createOptimistic(() => fetcher.fetch(id()));
      const pending = createMemo(() => isPending(data));
      createRenderEffect(pending, v => {
        pendingLog.push(v);
      });
      createRenderEffect(data, v => {
        valueLog.push(v);
      });
    });
    flush();
    fetcher.resolveAll();
    await settle();
    expect(valueLog).toEqual([10]);
    expect(pendingLog).toEqual([false]);

    // Optimistic write starts a transition; async for id=2 is in flight.
    setId(2);
    setData(20);
    flush();
    // The spinner fired without waiting for the fetch — this is the whole
    // point of the companion child lane.
    expect(pendingLog).toEqual([false, true]);
    // The override is visible immediately through its own lane.
    expect(valueLog).toEqual([10, 20]);

    fetcher.resolveAll();
    await settle();
    expect(pendingLog).toEqual([false, true, false]);
    expect(data()).toBe(20);
  });
});

describe("A15 (was B3): overlapping transitions settle as one unit", () => {
  // Transition merging is graph-driven: writes whose async work is observed by
  // a *shared* reader join one transition and settle together; writes on
  // fully disjoint graphs keep independent transitions and settle
  // independently. Both halves are the spec.
  it("a shared reader forces one settle point: nothing commits until both asyncs resolve", async () => {
    const [a, setA] = createSignal(1);
    const [b, setB] = createSignal(1);
    const fetchA = deferredFetcher((t: number) => t * 10);
    const fetchB = deferredFetcher((t: number) => t * 100);
    const log: string[] = [];

    createRoot(() => {
      const ma = createMemo(() => fetchA.fetch(a()));
      const mb = createMemo(() => fetchB.fetch(b()));
      // The shared reader entangles both sources' transitions.
      const joined = createMemo(() => `${ma()}|${mb()}`);
      createRenderEffect(joined, v => {
        log.push(v);
      });
    });
    flush();
    fetchA.resolveAll();
    fetchB.resolveAll();
    await settle();
    expect(log).toEqual(["10|100"]);
    log.length = 0;

    // Write A (async in flight), then write B before A resolves.
    setA(2);
    flush();
    setB(2);
    flush();

    // A's fetch resolves first. The joint view must NOT tear to "20|100":
    // the merged transition is still blocked on B.
    fetchA.resolveAll();
    await settle();
    expect(log).toEqual([]);

    // B resolves: one commit, both new values at once.
    fetchB.resolveAll();
    await settle();
    expect(log).toEqual(["20|200"]);
  });

  it("disjoint graphs keep independent transitions: each settles on its own", async () => {
    const [a, setA] = createSignal(1);
    const [b, setB] = createSignal(1);
    const fetchA = deferredFetcher((t: number) => t * 10);
    const fetchB = deferredFetcher((t: number) => t * 100);
    const log: string[] = [];

    createRoot(() => {
      const ma = createMemo(() => fetchA.fetch(a()));
      const mb = createMemo(() => fetchB.fetch(b()));
      createRenderEffect(ma, v => {
        log.push(`a=${v}`);
      });
      createRenderEffect(mb, v => {
        log.push(`b=${v}`);
      });
    });
    flush();
    fetchA.resolveAll();
    fetchB.resolveAll();
    await settle();
    expect(log.sort()).toEqual(["a=10", "b=100"]);
    log.length = 0;

    setA(2);
    flush();
    setB(2);
    flush();

    // No shared reader: A's update does not wait for B's.
    fetchA.resolveAll();
    await settle();
    expect(log).toEqual(["a=20"]);

    fetchB.resolveAll();
    await settle();
    expect(log).toEqual(["a=20", "b=200"]);
  });
});

describe("A16 (was B5): isPending never throws in untracked contexts", () => {
  it("returns false when the thunk throws a real error", () => {
    expect(
      isPending(() => {
        throw new Error("boom");
      })
    ).toBe(false);
  });

  it("returns false for an uninitialized async source (initial load is not pending)", async () => {
    const fetcher = deferredFetcher((t: number) => t);
    let data!: SourceAccessor<number>;
    createRoot(() => {
      data = createMemo(() => fetcher.fetch(1));
      createRenderEffect(data, () => {});
    });
    flush();

    // Uninitialized: read(data) throws NotReadyError; isPending swallows it.
    expect(isPending(data)).toBe(false);

    fetcher.resolveAll();
    await settle();
    expect(isPending(data)).toBe(false);
    expect(data()).toBe(1);
  });

  // B5a carve-out (pinned as current behavior): in *tracked* contexts the
  // NotReadyError of an uninitialized source propagates, so a memo computing
  // isPending participates in loading boundaries like any other async read.
  it("tracked isPending of an uninitialized source participates in a loading boundary (B5a)", async () => {
    const fetcher = deferredFetcher((t: number) => t * 10);
    let result: unknown;

    createRoot(() => {
      const data = createMemo(() => fetcher.fetch(1));
      const pending = createMemo(() => isPending(data));
      const boundary = createLoadingBoundary(
        () => `pending:${pending()}`,
        () => "loading"
      );
      createRenderEffect(
        () => (result = boundary()),
        () => {}
      );
    });
    flush();
    expect(result).toBe("loading");

    fetcher.resolveAll();
    await settle();
    expect(result).toBe("pending:false");
  });
});
