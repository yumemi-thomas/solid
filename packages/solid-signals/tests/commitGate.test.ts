// Exercises the `setCommitGate` seam: the hook a DOM renderer installs so a
// completed transition's commit WAITS for an in-flight browser view transition
// to finish (returning its `finished` promise) instead of committing immediately
// and aborting that animation. Writes that arrive during the wait coalesce into
// the same transition, so the deferred re-flush commits the latest state.
// See scheduler.ts `commitGate` / the defer in `GlobalQueue.flush()`.

import {
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  setCommitGate,
  startTransition
} from "../src/index.js";

afterEach(() => {
  setCommitGate(null);
  flush();
});

// Set up a render effect on a fresh signal inside a root; writes are done by the
// caller OUTSIDE the root's synchronous scope (so they aren't owned-scope writes).
function setup() {
  const [s, setS] = createSignal("a");
  const observed: string[] = [];
  let runs = 0;
  let dispose!: () => void;
  createRoot(d => {
    dispose = d;
    createRenderEffect(
      () => s(),
      v => {
        runs++;
        observed.push(v);
      }
    );
    flush();
  });
  observed.length = 0;
  runs = 0;
  return { setS, observed, dispose, runs: () => runs };
}

it("defers a transition commit until the gate's promise settles", async () => {
  let resolveGate: () => void = () => {};
  let gateReturns: PromiseLike<void> | null = new Promise<void>(r => (resolveGate = r));
  setCommitGate(() => gateReturns);

  const { setS, observed, dispose } = setup();

  // Sync transition completes and tries to commit, but the gate is "animating".
  startTransition(() => setS("b"));
  expect(observed).toEqual([]); // commit deferred — "b" not applied yet

  // Re-flush after the gate clears returns null → the commit proceeds.
  gateReturns = null;
  resolveGate();
  await Promise.resolve();
  await Promise.resolve();
  flush();
  expect(observed).toEqual(["b"]);
  dispose();
});

it("coalesces writes during the wait so only the latest commits, once", async () => {
  let resolveGate: () => void = () => {};
  let gateReturns: PromiseLike<void> | null = new Promise<void>(r => (resolveGate = r));
  setCommitGate(() => gateReturns);

  const { setS, observed, dispose, runs } = setup();

  startTransition(() => setS("b")); // deferred by the gate
  startTransition(() => setS("c")); // merges into the waiting transition
  startTransition(() => setS("d"));
  expect(observed).toEqual([]); // nothing committed while gated

  gateReturns = null;
  resolveGate();
  await Promise.resolve();
  await Promise.resolve();
  flush();

  // One commit, to the latest value — intermediate "b"/"c" never painted.
  expect(observed).toEqual(["d"]);
  expect(runs()).toBe(1);
  dispose();
});

it("commits even if the gate promise rejects (aborted/skipped transition)", async () => {
  let rejectGate: (e?: unknown) => void = () => {};
  let gateReturns: PromiseLike<void> | null = new Promise<void>((_, rej) => (rejectGate = rej));
  setCommitGate(() => gateReturns);

  const { setS, observed, dispose } = setup();

  startTransition(() => setS("b"));
  expect(observed).toEqual([]);

  gateReturns = null;
  rejectGate(new Error("aborted")); // a rejected "finished" still means "free now"
  await Promise.resolve();
  await Promise.resolve();
  flush();
  expect(observed).toEqual(["b"]);
  dispose();
});

it("does not defer a plain synchronous (non-transition) update", () => {
  // Gate is permanently "animating"; sync updates must bypass it (React parity:
  // a sync update commits immediately and cuts the animation).
  setCommitGate(() => Promise.resolve());

  const { setS, observed, dispose } = setup();

  setS("b");
  flush(); // no activeTransition → never reaches the gate
  expect(observed).toEqual(["b"]);
  dispose();
});
