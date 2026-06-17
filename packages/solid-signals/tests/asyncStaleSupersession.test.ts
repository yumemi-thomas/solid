// Regression: an async derivation must commit the value of the LATEST requested
// source, not the last promise to RESOLVE. When a source signal changes rapidly
// (a -> b -> c), each change starts a fresh async derivation; if an earlier
// (stale) one resolves after a newer one — e.g. because a cache makes a
// re-requested key resolve instantly, scrambling resolution vs request order —
// its write must be discarded.
//
// The mechanism under test is the `el._inFlight` identity check in
// core/async.ts `handleAsync`: a resolution callback bails when `el._inFlight`
// no longer points at its own promise (the node recomputed and adopted a newer
// one). This mirrors the TodoDemo: a derived createOptimisticStore whose fn
// returns a promise of an array, keyed by a source signal.

import {
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  setCommitGate,
  setTransitionCommitWrapper
} from "../src/index.js";

afterEach(() => {
  setCommitGate(null);
  setTransitionCommitWrapper(null);
  flush();
});

// A derived optimistic store keyed by a source signal, with per-key promises we
// resolve by hand so the test controls resolution order independently of request
// order (simulating a cache where a re-requested key resolves instantly).
function makeStore() {
  const resolvers: Record<string, (v: { id: number }[]) => void> = {};
  const promises: Record<string, Promise<{ id: number }[]>> = {};
  const fetchMock = (key: string) =>
    (promises[key] ||= new Promise<{ id: number }[]>(r => (resolvers[key] = r)));
  const [key, setKey] = createSignal("a");
  const [state] = createOptimisticStore<{ id: number }[]>(() => fetchMock(key()), []);
  // A render effect keeps the projection live (matches a mounted view reading it).
  createRoot(() =>
    createRenderEffect(
      () => state.length,
      () => {}
    )
  );
  return { state, setKey, resolvers };
}

async function settle(n = 4) {
  for (let i = 0; i < n; i++) await Promise.resolve();
  flush();
}

it("discards a stale earlier request that resolves after the latest", async () => {
  const { state, setKey, resolvers } = makeStore();
  flush();
  resolvers.a([{ id: 1 }]);
  await settle();
  expect(state.length).toBe(1);

  // Rapid a -> b -> c (c is the latest request).
  setKey("b");
  flush();
  setKey("c");
  flush();

  // c resolves FIRST (3 items)...
  resolvers.c([{ id: 1 }, { id: 2 }, { id: 3 }]);
  await settle();
  // ...then the stale b resolves LATER (2 items) — it must be discarded.
  resolvers.b([{ id: 1 }, { id: 2 }]);
  await settle();

  expect(state.length).toBe(3); // latest (c) wins, not last-to-resolve (b)
});

it("still commits the latest when it resolves last (normal staggered order)", async () => {
  const { state, setKey, resolvers } = makeStore();
  flush();
  resolvers.a([{ id: 1 }]);
  await settle();
  expect(state.length).toBe(1);

  setKey("b");
  flush();
  setKey("c");
  flush();

  // b (stale) resolves first, then c (latest) — c must win.
  resolvers.b([{ id: 1 }, { id: 2 }]);
  await settle();
  resolvers.c([{ id: 1 }, { id: 2 }, { id: 3 }]);
  await settle();

  expect(state.length).toBe(3);
});

it("lands on the latest when re-requesting an already-resolved (cached) key mid-burst", async () => {
  const { state, setKey, resolvers } = makeStore();
  flush();
  resolvers.a([{ id: 1 }]);
  await settle();

  // a -> b -> a : 'a' is already resolved (cached), so its promise is instant.
  setKey("b");
  flush();
  setKey("a");
  flush();
  // b resolves later (stale) — must not overwrite the latest ('a').
  resolvers.b([{ id: 1 }, { id: 2 }]);
  await settle();

  expect(state.length).toBe(1); // latest is 'a' (1 item), not stale b (2)
});

it("supersedes correctly with the full view-transition stack installed", async () => {
  // The commit gate + transition-commit-wrapper are what solid-web installs for
  // automatic view transitions; supersession must hold with them in place.
  setTransitionCommitWrapper(applyMutations => {
    applyMutations();
  });
  setCommitGate(() => null);

  const { state, setKey, resolvers } = makeStore();
  flush();
  resolvers.a([{ id: 1 }]);
  await settle();

  setKey("b");
  flush();
  setKey("c");
  flush();
  // c (latest) resolves first, stale b resolves later.
  resolvers.c([{ id: 1 }, { id: 2 }, { id: 3 }]);
  await settle();
  resolvers.b([{ id: 1 }, { id: 2 }]);
  await settle();

  expect(state.length).toBe(3);
});
