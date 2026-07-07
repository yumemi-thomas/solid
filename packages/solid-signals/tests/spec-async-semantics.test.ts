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
  action,
  createLoadingBoundary,
  createMemo,
  createOptimistic,
  createOptimisticStore,
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

describe("A17 (was C4): an active override is THE value — every reader, until its async settles", () => {
  // Maintainer ruling (2026-07-06): "override should always be read if
  // present.. it is the optimistic future value, it is both immediate and is
  // the future until we know otherwise." That must not depend on whether the
  // node's transition got entangled (merged) with other async work. The
  // override holds while the node's own async is still in flight and reverts
  // to the fresh value only when the owning transition completes.
  //
  // Before the fix, transitionComplete excluded a node pending on ITS OWN
  // fetch from blocking completion (`_error.source !== node`), so an
  // entangled transition completed on the first flush and silently dropped
  // the override — the ambient read returned the committed value while
  // tracked readers had seen the override for one tick.
  it("entangled graph: ambient and tracked reads both hold the override until completion", async () => {
    const [id, setId] = createSignal(1);
    const [other, setOther] = createSignal(1);
    const dataFetch = deferredFetcher((t: number) => t * 10);
    const otherFetch = deferredFetcher((t: number) => t * 100);
    const log: string[] = [];

    let data!: SourceAccessor<number>;
    let setData!: (v: number) => void;
    createRoot(() => {
      [data, setData] = createOptimistic(() => dataFetch.fetch(id()));
      const mOther = createMemo(() => otherFetch.fetch(other()));
      const joined = createMemo(() => `${data()}|${mOther()}`);
      createRenderEffect(joined, v => {
        log.push(v);
      });
    });
    flush();
    dataFetch.resolveAll();
    otherFetch.resolveAll();
    await settle();
    log.length = 0;

    // Both sources refetch (entangled through `joined`) + user override.
    setId(2);
    setOther(2);
    setData(99);
    flush();
    // Tracked (lane-routed) reader sees the override...
    expect(log).toEqual(["99|100"]);
    // ...and so does the ambient read — same as the simple graph (B4 test).
    expect(data()).toBe(99);

    dataFetch.resolveAll();
    await settle();

    otherFetch.resolveAll();
    await settle();
    // Everything settled: reverted to the fresh async value everywhere.
    expect(data()).toBe(20);
    expect(log[log.length - 1]).toBe("20|200");
  });

  // No-tearing is enforced at the EFFECT level, not the read level (ruling
  // 2026-07-07): async derived FROM the optimistic value holds the lane's
  // render effects — the rendered view moves as one unit — while direct reads
  // (ambient included) return the override immediately ("direct read shows
  // optimistic, effect waits"). The real-world CategoryDisplay/News-Finance
  // suites in createOptimistic.test.ts pin this extensively; this is the
  // minimal spec statement.
  it("downstream async: direct read shows the override immediately, lane effects wait for it", async () => {
    const [id, setId] = createSignal(1);
    const dataFetch = deferredFetcher((t: number) => t * 10);
    const derivedFetch = deferredFetcher((t: number) => `derived(${t})`);
    const valueLog: number[] = [];
    const derivedLog: string[] = [];

    let data!: SourceAccessor<number>;
    let setData!: (v: number) => void;
    createRoot(() => {
      [data, setData] = createOptimistic(() => dataFetch.fetch(id()));
      const derived = createMemo(() => derivedFetch.fetch(data()));
      createRenderEffect(data, v => {
        valueLog.push(v);
      });
      createRenderEffect(derived, v => {
        derivedLog.push(v);
      });
    });
    flush();
    dataFetch.resolveAll();
    await settle();
    derivedFetch.resolveAll();
    await settle();
    valueLog.length = 0;
    derivedLog.length = 0;

    // Refetch + override: derived(99) is now in flight in the override's lane.
    setId(2);
    setData(99);
    flush();
    // Direct read shows the override immediately...
    expect(data()).toBe(99);
    // ...but the lane holds BOTH its effects (value and derived move together).
    expect(valueLog).toEqual([]);
    expect(derivedLog).toEqual([]);

    // Downstream async for the optimistic view resolves: the view appears
    // atomically — no tearing, no window where value updated but derived hadn't.
    derivedFetch.resolveAll();
    await settle();
    expect(valueLog).toEqual([99]);
    expect(derivedLog).toEqual(["derived(99)"]);

    // Real refetch lands: corrected value flows through the same unit.
    dataFetch.resolveAll();
    await settle();
    derivedFetch.resolveAll();
    await settle();
    expect(data()).toBe(20);
    expect(valueLog).toEqual([99, 20]);
    expect(derivedLog).toEqual(["derived(99)", "derived(20)"]);
  });

  it("simple graph: override visible ambiently until its own fetch settles", async () => {
    const [id, setId] = createSignal(1);
    const fetcher = deferredFetcher((t: number) => t * 10);

    let data!: SourceAccessor<number>;
    let setData!: (v: number) => void;
    createRoot(() => {
      [data, setData] = createOptimistic(() => fetcher.fetch(id()));
      createRenderEffect(data, () => {});
    });
    flush();
    fetcher.resolveAll();
    await settle();
    expect(data()).toBe(10);

    setId(2);
    setData(99);
    flush();
    expect(data()).toBe(99);

    fetcher.resolveAll();
    await settle();
    expect(data()).toBe(20);
  });
});

describe("A18 (was B4): an override's lifetime is bound to its own async source, not its transition", () => {
  // Maintainer ruling (2026-07-07): "overrides clear when their async source
  // resolves.. otherwise unrelated parts of a transition can get held up
  // waiting for other async to resolve, especially if the optimistic value
  // needs correction and triggers further async." The authoritative value
  // wins the moment it arrives; the correction cascade (and any async it
  // triggers) must not wait for strangers in a merged transition.
  it("entangled: own-source resolution clears the override while an unrelated fetch is still pending", async () => {
    const [id, setId] = createSignal(1);
    const [other, setOther] = createSignal(1);
    const dataFetch = deferredFetcher((t: number) => t * 10);
    const otherFetch = deferredFetcher((t: number) => t * 100);
    const log: string[] = [];

    let data!: SourceAccessor<number>;
    let setData!: (v: number) => void;
    createRoot(() => {
      [data, setData] = createOptimistic(() => dataFetch.fetch(id()));
      const mOther = createMemo(() => otherFetch.fetch(other()));
      const joined = createMemo(() => `${data()}|${mOther()}`);
      createRenderEffect(joined, v => {
        log.push(v);
      });
    });
    flush();
    dataFetch.resolveAll();
    otherFetch.resolveAll();
    await settle();
    log.length = 0;

    // Entangled refetches + user override.
    setId(2);
    setOther(2);
    setData(99);
    flush();
    expect(data()).toBe(99); // override active while own fetch is in flight (A17)

    // Own source resolves: the fresh value wins NOW — the override must not be
    // held hostage by the still-pending unrelated fetch in the merged transition.
    dataFetch.resolveAll();
    await settle();
    expect(data()).toBe(20);

    otherFetch.resolveAll();
    await settle();
    expect(data()).toBe(20);
    expect(log[log.length - 1]).toBe("20|200");
  });

  // In the simple (unentangled) graph, own-source resolution and transition
  // completion coincide — the override is visible from the write until the
  // refetch lands, then corrects to the fresh value (never the pre-write one).
  it("simple graph: override visible until its own refetch lands, then corrects to the fresh value", async () => {
    const [id, setId] = createSignal(1);
    const fetcher = deferredFetcher((t: number) => t * 10);
    const valueLog: number[] = [];

    let data!: SourceAccessor<number>;
    let setData!: (v: number) => void;
    createRoot(() => {
      [data, setData] = createOptimistic(() => fetcher.fetch(id()));
      createRenderEffect(data, v => {
        valueLog.push(v);
      });
    });
    flush();
    fetcher.resolveAll();
    await settle();
    expect(valueLog).toEqual([10]);
    valueLog.length = 0;

    // Refetch + user override written while the fetch is in flight.
    setId(2);
    setData(99);
    flush();
    expect(data()).toBe(99);
    expect(valueLog).toEqual([99]);

    fetcher.resolveAll();
    await settle();
    // Own async source resolved: corrected to the fresh value, not the
    // pre-write value.
    expect(data()).toBe(20);
    expect(valueLog).toEqual([99, 20]);
  });
});

describe("A19 (was C1): isPending(x) = the observable value of x is not final", () => {
  // Ruling (2026-07-07): three causes of non-finality — (i) write held by a
  // transition (ends at commit), (ii) own async in flight (ends at
  // resolution), (iii) fresh value held uncommitted by an entangled
  // transition (ends at that commit). Pending while any cause holds, final
  // the moment none does. Uninitialized async is loading, not pending —
  // the initial NotReady plays to boundaries (SSR/hydration), see A16.
  // These tests pin the cause-(i) half and the boundary interplay. Causes
  // (ii)/(iii) — verdicts that must survive the transition's death — were
  // implemented by the #2838 redesign and are pinned in the "V1–V4" describe
  // at the bottom of this file.

  it("cause (i): a held trigger write is pending until commit, final at commit", async () => {
    const [tick, setTick] = createSignal(1);
    const fetcher = deferredFetcher((t: number) => t * 10);

    let data!: SourceAccessor<number>;
    createRoot(() => {
      data = createMemo(() => fetcher.fetch(tick()));
      createRenderEffect(data, () => {});
    });
    flush();
    fetcher.resolveAll();
    await settle();
    expect(isPending(tick)).toBe(false);

    setTick(2);
    flush();
    // The write is held: the observable tick() is still 1 — not final.
    expect(tick()).toBe(1);
    expect(isPending(tick)).toBe(true);
    expect(isPending(data)).toBe(true); // its refetch is in flight too

    fetcher.resolveAll();
    await settle();
    // Commit: everything observable is final.
    expect(tick()).toBe(2);
    expect(isPending(tick)).toBe(false);
    expect(isPending(data)).toBe(false);
  });

  it("initialized refetch under a nested loading boundary: content holds, verdicts stay pending until resolution", async () => {
    const [tick, setTick] = createSignal(1);
    const fetcher = deferredFetcher((t: number) => t * 10);
    let rendered: unknown;

    let data!: SourceAccessor<number>;
    createRoot(() => {
      data = createMemo(() => fetcher.fetch(tick()));
      const boundary = createLoadingBoundary(
        () => `v:${data()}`,
        () => "loading"
      );
      createRenderEffect(
        () => (rendered = boundary()),
        () => {}
      );
    });
    flush();
    fetcher.resolveAll();
    await settle();
    expect(rendered).toBe("v:10");

    setTick(2);
    flush();
    // Initialized refetch: no fallback — the boundary holds the old content
    // (fallbacks are for initial loads), and both verdicts report non-final.
    expect(rendered).toBe("v:10");
    expect(isPending(tick)).toBe(true);
    expect(isPending(data)).toBe(true);

    fetcher.resolveAll();
    await settle();
    expect(rendered).toBe("v:20");
    expect(isPending(tick)).toBe(false);
    expect(isPending(data)).toBe(false);
  });

  it("nav revealing an uninitialized async: trigger pending until the new view can show, data is loading (not pending)", async () => {
    const [location, setLocation] = createSignal(1);
    const fetcher = deferredFetcher((t: number) => t * 10);
    let rendered: unknown;

    // page2's data is only read once we navigate — uninitialized until then.
    createRoot(() => {
      const page2Data = createMemo(() => fetcher.fetch(location()));
      const boundary = createLoadingBoundary(
        () => (location() === 2 ? `page2:${page2Data()}` : "page1"),
        () => "fallback"
      );
      createRenderEffect(
        () => (rendered = boundary()),
        () => {}
      );
    });
    flush();
    expect(rendered).toBe("page1");

    setLocation(2);
    flush();
    // The nav can't land yet (page2's data is uninitialized): old view holds,
    // the trigger's observable value is not final.
    expect(rendered).toBe("page1");
    expect(location()).toBe(1);
    expect(isPending(location)).toBe(true);

    fetcher.resolveAll();
    await settle();
    // The new view can show its landed value: nothing is pending anymore.
    expect(rendered).toBe("page2:20");
    expect(location()).toBe(2);
    expect(isPending(location)).toBe(false);
  });
});

describe("A20: overrides are unsettled; pending scope is a property of the read", () => {
  // Ruling (2026-07-07): an ACTIVE optimistic override reads pending —
  // uniformly, on every node kind. Overrides mask stale content (A17: the
  // override is the value every read sees), not settlement: until its own
  // source confirms it (A18) or the transition reverts it, the shown value is
  // unconfirmed, and `isPending` reports unsettledness, never what UI to show.
  // "Optimistic state is often the loading state" — the community
  // no-extra-boolean idioms (isPending(() => books.length) as the "Adding…"
  // label) are built on this.
  //
  // Scope falls out of the read-performs principle: isPending(fn) reports
  // unsettledness of what fn TOUCHED. A refetch pends every read of a store
  // because the authority is recomputing (unbounded change set); an
  // optimistic write pends exactly the leaves it wrote (known change set) —
  // untouched siblings stay settled. Broad-on-demand stays available by
  // reading broadly.
  //
  // The three forms — `latest` strips COORDINATION, nothing strips
  // CONFIRMATION: transition holds and broad firewall inheritance are
  // coordination (the future value is known; the wait is atomicity) and the
  // latest view absorbs them. A node's own async in flight and an active
  // override are confirmation-uncertainty (the future value is unknown) and
  // read pending under BOTH forms. Pair the form with what you render:
  // committed view x() → isPending(x); optimistic visual latest(x) →
  // isPending(() => latest(x)).

  it("optimistic computed: override + own fetch reads pending under all three forms, all clear when the fetch lands", async () => {
    const fetcher = deferredFetcher((t: number) => t * 10);
    const [id, setId] = createSignal(1);
    let data!: SourceAccessor<number>;
    let setData!: (v: number) => void;
    createRoot(() => {
      [data, setData] = createOptimistic(() => fetcher.fetch(id()));
      createRenderEffect(data, () => {});
    });
    flush();
    fetcher.resolveAll();
    await settle();
    expect(isPending(data)).toBe(false);

    setId(2);
    setData(999); // prediction for id=2
    flush();
    expect(data()).toBe(999); // A17: the override is the value
    expect(isPending(id)).toBe(true); // held write (coordination)
    expect(isPending(data)).toBe(true); // unconfirmed override + own fetch
    expect(isPending(() => latest(data))).toBe(true); // confirmation is never stripped

    fetcher.resolveAll();
    await settle();
    // Own source landed: override cleared (A18), everything final at once.
    expect(data()).toBe(20);
    expect(isPending(id)).toBe(false);
    expect(isPending(data)).toBe(false);
    expect(isPending(() => latest(data))).toBe(false);
  });

  it("optimistic signal in an action: the override alone is unsettled (no refetch anywhere) — the no-extra-boolean idiom", async () => {
    // A non-derived optimistic signal has no source that can confirm its
    // guess — reversion is certain, so the shown value is never final:
    // pending for the override's whole lifetime. This is what makes
    // `adding()`-style flags readable straight off the optimistic state.
    const [adding, setAdding] = createOptimistic(false);
    let release!: () => void;
    let run!: () => Promise<void>;
    createRoot(() => {
      createRenderEffect(adding, () => {});
      run = action(function* () {
        setAdding(true);
        yield new Promise<void>(r => (release = r));
      });
    });
    flush();
    expect(isPending(adding)).toBe(false);

    const done = run();
    flush();
    expect(adding()).toBe(true); // override visible (A17)
    expect(isPending(adding)).toBe(true); // and unsettled — it WILL revert

    release();
    await done;
    await settle();
    expect(adding()).toBe(false);
    expect(isPending(adding)).toBe(false);
  });

  it("store: an optimistic edit pends the leaves it touched, not untouched siblings", async () => {
    let release!: () => void;
    let run!: () => Promise<void>;
    let state!: { title: string; author: string };
    let setState!: (fn: (s: { title: string; author: string }) => void) => void;
    createRoot(() => {
      [state, setState] = createOptimisticStore({ title: "t1", author: "a1" });
      createRenderEffect(
        () => `${state.title}|${state.author}`,
        () => {}
      );
      run = action(function* () {
        setState(s => {
          s.title = "t2";
        });
        yield new Promise<void>(r => (release = r));
      });
    });
    flush();

    const done = run();
    flush();
    expect(state.title).toBe("t2");
    // The write's change set is known: title is unsettled, author is not.
    expect(isPending(() => state.title)).toBe(true);
    expect(isPending(() => state.author)).toBe(false);

    release();
    await done;
    await settle();
    expect(state.title).toBe("t1"); // reverted (non-derived store: transaction-scoped)
    expect(isPending(() => state.title)).toBe(false);
    expect(isPending(() => state.author)).toBe(false);
  });
});

/**
 * V1–V4 — the four known violations found while characterizing the
 * blocked-merged-transition window (2026-07-06/07), fixed by the #2838
 * companion/shadow redesign (2026-07-07). Formerly `it.fails` pins in
 * spec-async-open-questions.test.ts; promoted here on the day they flipped.
 *
 * The "blocked-merged window": a node's own fetch resolved, but a shared
 * reader entangles it with another still-pending async source, so nothing
 * commits yet.
 */
describe("V1–V5: verdicts in and after the blocked-merged window (fixed 2026-07-07)", () => {
  // Shared harness: data's async is entangled with a second async source
  // through a shared reader; data's own fetch has resolved, but the merged
  // transition is still blocked on the other fetch.
  async function enterBlockedWindow(kind: "plain" | "optimistic", prime: boolean) {
    const [id, setId] = createSignal(1);
    const [other, setOther] = createSignal(1);
    const dataFetch = deferredFetcher((t: number) => t * 10);
    const otherFetch = deferredFetcher((t: number) => t * 100);

    let data!: SourceAccessor<number>;
    createRoot(() => {
      if (kind === "plain") {
        data = createMemo(() => dataFetch.fetch(id()));
      } else {
        data = createOptimistic(() => dataFetch.fetch(id()))[0];
      }
      const mOther = createMemo(() => otherFetch.fetch(other()));
      const joined = createMemo(() => `${data()}|${mOther()}`);
      createRenderEffect(joined, () => {});
    });
    flush();
    dataFetch.resolveAll();
    otherFetch.resolveAll();
    await settle();
    if (prime) {
      latest(data);
      isPending(data);
    }

    setId(2);
    setOther(2);
    flush();
    dataFetch.resolveAll();
    await settle();
    // In the window now: data's fetch resolved to 20, transition blocked on other.
    return {
      data,
      finish: async () => {
        otherFetch.resolveAll();
        await settle();
      }
    };
  }

  // Control: the plain memo's behavior in the window — the reference point
  // A13 holds the resting optimistic node to.
  it("control (plain memo): stale read, fresh latest, isPending true in the window", async () => {
    const w = await enterBlockedWindow("plain", true);
    expect(w.data()).toBe(10);
    expect(latest(w.data)).toBe(20);
    expect(isPending(w.data)).toBe(true);
    await w.finish();
    expect(w.data()).toBe(20);
    expect(isPending(w.data)).toBe(false);
  });

  // V1 (A13): a resting optimistic node in the window matches the plain-memo
  // control — stale read, isPending TRUE. Fixed by (a) removing the #2799
  // carve-out from computePendingState (a resting node never holds a revert
  // target — revert targets only coexist with an ACTIVE override — so a held
  // value on a resting node is always a refetch/transition hold), and (b)
  // asyncWrite's resting hold syncing companions like every other write.
  it("V1/A13: resting optimistic reports isPending true in the window", async () => {
    const w = await enterBlockedWindow("optimistic", true);
    expect(w.data()).toBe(10);
    expect(latest(w.data)).toBe(20);
    expect(isPending(w.data)).toBe(true);
    await w.finish();
    expect(w.data()).toBe(20);
    expect(isPending(w.data)).toBe(false);
  });

  // V1, unprimed variant: companions created *inside* the window must derive
  // the same verdict as pre-existing ones — verdicts don't depend on when the
  // consumer first probed.
  it("V1/A13: a companion created inside the window derives the same verdict", async () => {
    const w = await enterBlockedWindow("optimistic", false);
    expect(isPending(w.data)).toBe(true);
    await w.finish();
    expect(isPending(w.data)).toBe(false);
  });

  // V2 (A7/A13): latest()'s verdict must not be read-order dependent. An
  // early probe (made while both fetches were in flight) must not freeze the
  // shadow at the stale value for the rest of the window. Fixed by the same
  // resting-hold companion sync: the arriving value is pushed into the
  // shadow instead of waiting for a recompute that never comes.
  it("V2/A7: an early probe does not freeze latest() at the stale value for the window", async () => {
    const w = await enterBlockedWindow("optimistic", true);
    // (enterBlockedWindow probed once in-flight via prime, then the data
    // fetch landed.) latest() now shows the fresh in-flight value:
    expect(latest(w.data)).toBe(20);
    expect(isPending(w.data)).toBe(true);
    await w.finish();
    expect(latest(w.data)).toBe(20);
    expect(isPending(w.data)).toBe(false);
  });

  // V3 (A19): isPending is data-centric — cause (ii) of non-finality (own
  // async in flight) survives the transition's death. In pure-signals graphs
  // (no render-effect reporters) the transition completes on the first flush
  // while the refetch is still in flight; the companion must re-derive from
  // the data's state, not keep a transition-scoped verdict. Fixed by the
  // settlement checkpoint: optimistic reverts re-derive companions from
  // committed state (snapCompanionsToState).
  it("V3/A19: isPending stays true during the post-transition refetch window", async () => {
    const [tick, setTick] = createSignal(1);
    const fetcher = deferredFetcher((t: number) => t * 10);

    let data!: SourceAccessor<number>;
    createRoot(() => {
      data = createMemo(() => fetcher.fetch(tick()));
    });

    isPending(data); // companion exists before the write
    fetcher.resolveAll();
    await settle();
    expect(latest(data)).toBe(10);
    expect(isPending(data)).toBe(false);

    setTick(2);
    flush();
    // Transition already completed (no reporters), refetch in flight, the
    // observable value is the stale 10 — not final, so pending is true.
    expect(latest(data)).toBe(10);
    expect(isPending(data)).toBe(true);

    fetcher.resolveAll();
    await settle();
    expect(latest(data)).toBe(20);
    expect(isPending(data)).toBe(false);
  });

  // V4 (A20 three-form algebra): `latest` strips COORDINATION. A firewall
  // refetch seen from an optimistic store leaf with no unconfirmed edit is
  // coordination-shaped (broad inheritance), so the latest form filters it
  // while the plain form reports it — the community "refresh-noise" idiom.
  // And once the refresh settles, the verdict clears (the firewall's status
  // change pokes probed leaf companions — no more stuck-true companion).
  it("V4/A20: latest-form on an optimistic store leaf filters a pure firewall refresh and clears at settle", async () => {
    let resolveFetch!: (n: number) => void;
    const [tick, setTick] = createSignal(0);
    let state!: { title: string };
    createRoot(() => {
      [state] = createOptimisticStore(
        async (s: { title: string }) => {
          tick();
          const n = await new Promise<number>(r => (resolveFetch = r));
          s.title = "server" + n;
        },
        { title: "init" }
      );
      createRenderEffect(
        () => state.title,
        () => {}
      );
    });
    flush();
    resolveFetch(1);
    await settle();
    expect(state.title).toBe("server1");

    // Pure refresh: no optimistic edit anywhere. The plain form reports the
    // broad refetch; the latest form filters it.
    setTick(1);
    flush();
    expect(isPending(() => state.title)).toBe(true);
    expect(isPending(() => latest(() => state.title))).toBe(false);

    resolveFetch(2);
    await settle();
    expect(state.title).toBe("server2");
    expect(isPending(() => state.title)).toBe(false);
    expect(isPending(() => latest(() => state.title))).toBe(false);
  });

  // V5 (A17/A18 corollary — found and fixed with the revert-target
  // elimination, 2026-07-07b): an authoritative refetch value held in the
  // blocked-merged window must survive a first optimistic write. The old
  // model stashed a revert target on first override (`_pendingValue =
  // _value`), clobbering the held refetch result; the override's revert then
  // resurrected the STALE committed value. With no revert targets, the held
  // value stays a pending commit and elevates at its own transition's commit
  // — unobservably under the override (A17) — so the revert reveals the
  // refetch result.
  it("V5/A17: optimistic write in the blocked window does not clobber the held refetch value", async () => {
    const [id, setId] = createSignal(1);
    const [other, setOther] = createSignal(1);
    const dataFetch = deferredFetcher((t: number) => t * 10);
    const otherFetch = deferredFetcher((t: number) => t * 100);

    let data!: SourceAccessor<number>;
    let setData!: (v: number) => void;
    let release!: () => void;
    let run!: () => Promise<void>;
    createRoot(() => {
      [data, setData] = createOptimistic(() => dataFetch.fetch(id()));
      const mOther = createMemo(() => otherFetch.fetch(other()));
      const joined = createMemo(() => `${data()}|${mOther()}`);
      createRenderEffect(joined, () => {});
      run = action(function* () {
        setData(999);
        yield new Promise<void>(r => (release = r));
      });
    });
    flush();
    dataFetch.resolveAll();
    otherFetch.resolveAll();
    await settle();
    expect(data()).toBe(10);

    // Enter the blocked window: data's fetch lands (20, held), other pending.
    setId(2);
    setOther(2);
    flush();
    dataFetch.resolveAll();
    await settle();
    expect(latest(data)).toBe(20);

    // Optimistic write while the window holds 20.
    const done = run();
    flush();
    expect(data()).toBe(999); // override visible (A17)

    // Everything settles: other fetch lands, action releases, override reverts.
    otherFetch.resolveAll();
    await settle();
    release();
    await done;
    await settle();

    // The refetch produced 20 for id=2; the revert must reveal it, not 10.
    expect(data()).toBe(20);
    expect(latest(data)).toBe(20);
    expect(isPending(data)).toBe(false);
  });
});
