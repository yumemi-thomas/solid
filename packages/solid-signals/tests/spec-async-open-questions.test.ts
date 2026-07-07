/**
 * OPEN-QUESTION CHARACTERIZATION TESTS — see SPEC-ASYNC-SEMANTICS.md Tier B/C.
 *
 * Unlike spec-async-semantics.test.ts, these do NOT pin ruled semantics. They
 * pin *current behavior* of the undecided propositions so that:
 *   1. any accidental behavior change surfaces as a diff we can see, and
 *   2. when a verdict lands, the test is either promoted to the spec file
 *      as-is (verdict = keep) or becomes the executable statement of what
 *      must change (verdict = change).
 *
 * The `it.fails` cases at the bottom are KNOWN VIOLATIONS of ruled Tier A
 * propositions, discovered while characterizing the blocked-merged-transition
 * window (2026-07-06). They are expected to fail; when one starts passing,
 * the bug it documents has been fixed — promote it to the spec file.
 *
 * If anything here fails unexpectedly, do not blindly fix code OR
 * expectation: check the spec document and get a verdict.
 */
import { describe, expect, it } from "vitest";
import {
  createMemo,
  createOptimistic,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  latest,
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
  await Promise.resolve();
  await Promise.resolve();
  flush();
};

/**
 * The "blocked-merged window": `data`'s async is entangled with a second
 * async source through a shared reader; data's own fetch has resolved, but
 * the merged transition is still blocked on the other fetch, so nothing has
 * committed. Several open questions and two known violations live here.
 */
async function enterBlockedWindow(kind: "plain" | "optimistic", prime: boolean) {
  const [id, setId] = createSignal(1);
  const [other, setOther] = createSignal(1);
  const dataFetch = deferredFetcher((t: number) => t * 10);
  const otherFetch = deferredFetcher((t: number) => t * 100);
  const log: string[] = [];

  let data!: SourceAccessor<number>;
  let setData!: (v: number) => void;
  createRoot(() => {
    if (kind === "plain") {
      data = createMemo(() => dataFetch.fetch(id()));
    } else {
      [data, setData] = createOptimistic(() => dataFetch.fetch(id()));
    }
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
  if (prime) {
    latest(data);
    isPending(data);
  }
  log.length = 0;

  setId(2);
  setOther(2);
  flush();
  dataFetch.resolveAll();
  await settle();
  // In the window now: data's fetch resolved to 20, transition blocked on other.
  return {
    data,
    setData,
    otherFetch,
    log,
    finish: async () => {
      otherFetch.resolveAll();
      await settle();
    }
  };
}

describe("B4 (undecided): user override vs async correction", () => {
  // Current behavior in the simple (unentangled) graph: the override is
  // visible from the write until its transition completes; async resolution
  // does not clobber it; at completion the node reverts to the FRESH async
  // value (20), not the pre-write value (10).
  it("override visible until completion, then reverts to the fresh async value", async () => {
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
    expect(data()).toBe(99); // ambient read sees the override (simple graph)
    expect(valueLog).toEqual([99]);

    fetcher.resolveAll();
    await settle();
    // Transition completed: reverts to the fresh async value.
    expect(data()).toBe(20);
    expect(valueLog).toEqual([99, 20]);
  });
});

describe("C1 (open): isPending after the transition completed but async still in flight", () => {
  // Pure-signals graph (no render effects): the transition completes
  // immediately on flush, while the refetch is still in flight and latest()
  // still shows the stale value. Current behavior: an existing isPending
  // companion keeps its lane-scoped verdict — FALSE — even though data is
  // being refetched. (A fresh computePendingState would say true; whether
  // that should win is the C1 decision.)
  it("pure-signals graph: isPending stays false during the post-transition refetch window", async () => {
    const [tick, setTick] = createSignal(1);
    const fetcher = deferredFetcher((t: number) => t * 10);

    let data!: SourceAccessor<number>;
    createRoot(() => {
      data = createMemo(() => fetcher.fetch(tick()));
    });

    // Companion exists before the write (C1 is about an existing companion).
    expect(isPending(data)).toBe(false); // uninitialized — not pending (A16)
    fetcher.resolveAll();
    await settle();
    expect(latest(data)).toBe(10);
    expect(isPending(data)).toBe(false);

    setTick(2);
    flush();
    // The stale value is still what latest() shows...
    expect(latest(data)).toBe(10);
    // ...but isPending reports false: no transition holds a view anymore.
    expect(isPending(data)).toBe(false);

    fetcher.resolveAll();
    await settle();
    expect(latest(data)).toBe(20);
    expect(isPending(data)).toBe(false);
  });
});

// C4 was ruled 2026-07-06 ("override should always be read if present") and
// promoted to A17 in spec-async-semantics.test.ts, together with the fix:
// transitionComplete no longer excludes a node pending on its own fetch from
// blocking completion, so entangled transitions can't silently drop overrides.

describe("known violations in the blocked-merged window (expected failures)", () => {
  // Control: the plain memo is coherent in the window — stale read, fresh
  // latest, pending true. This is the behavior A13 says a resting optimistic
  // node must match.
  it("control (plain memo): stale read, fresh latest, isPending true in the window", async () => {
    const w = await enterBlockedWindow("plain", true);
    expect(w.data()).toBe(10);
    expect(latest(w.data)).toBe(20);
    expect(isPending(w.data)).toBe(true);
    await w.finish();
    expect(w.data()).toBe(20);
    expect(isPending(w.data)).toBe(false);
  });

  // VIOLATION of A13 (resting optimistic ≡ plain memo): in the window the
  // resting optimistic node reports isPending FALSE while still showing the
  // stale value — a spinner keyed on it disappears before the data updates.
  // Root cause: computePendingState's #2799 carve-out skips the held
  // `_pendingValue` for every resting optimistic node, but here the held
  // value comes from an entangled refetch, not a reverting optimistic write.
  it.fails(
    "A13 violation: resting optimistic reports isPending true in the window (currently false)",
    async () => {
      const w = await enterBlockedWindow("optimistic", true);
      expect(w.data()).toBe(10);
      expect(isPending(w.data)).toBe(true); // currently false
      await w.finish();
    }
  );

  // VIOLATION of A7/A13: latest()'s verdict in the window is READ-ORDER
  // dependent. If the first in-window probe happens after the flush, it
  // reports the fresh 20; but a probe in the microtask gap between the
  // fetch resolution and the flush caches the stale 10 into the shadow, and
  // every later read keeps reporting 10 until the whole transition commits
  // (and `undefined` appears in override interleavings — the pair A7 rules
  // out). #2838's probe-driven shadow is the root cause: verdicts must not
  // depend on when the consumer happened to read.
  it.fails(
    "A7/A13 violation: an early probe must not freeze latest() at the stale value for the whole window",
    async () => {
      const [id, setId] = createSignal(1);
      const [other, setOther] = createSignal(1);
      const dataFetch = deferredFetcher((t: number) => t * 10);
      const otherFetch = deferredFetcher((t: number) => t * 100);

      let data!: SourceAccessor<number>;
      createRoot(() => {
        data = createOptimistic(() => dataFetch.fetch(id()))[0];
        const mOther = createMemo(() => otherFetch.fetch(other()));
        const joined = createMemo(() => `${data()}|${mOther()}`);
        createRenderEffect(joined, () => {});
      });
      flush();
      dataFetch.resolveAll();
      otherFetch.resolveAll();
      await settle();
      latest(data); // prime the shadow before the write
      isPending(data);

      setId(2);
      setOther(2);
      flush();
      // Probe while both fetches are in flight — legitimately reports the
      // stale 10 — but this read freezes the shadow for the rest of the window.
      expect(latest(data)).toBe(10);
      expect(isPending(data)).toBe(true);

      dataFetch.resolveAll();
      await settle();

      // Same checkpoint as the passing plain-memo control and the
      // probe-after-flush path — but the early probe froze the shadow at 10.
      expect(latest(data)).toBe(20); // currently 10

      otherFetch.resolveAll();
      await settle();
      expect(latest(data)).toBe(20);
    }
  );
});
