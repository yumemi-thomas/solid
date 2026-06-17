// Exercises the `setTransitionCommitWrapper` seam: the hook a DOM renderer
// installs so a committing transition's render (DOM-mutating) effects run
// inside its wrapper — e.g. `document.startViewTransition({ update })` — instead
// of every call site wrapping manually. See scheduler.ts `commitWithWrapper`.

import {
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  setTransitionCommitWrapper
} from "../src/index.js";

afterEach(() => {
  setTransitionCommitWrapper(null);
  flush();
});

// Drives an async transition to commit, mirroring transitionEntanglement.test.ts.
async function runCommittingTransition(observe: (v: string) => void) {
  let resolveAsync: (n: number) => void = () => {};
  const [s1, setS1] = createSignal(1);
  const a1 = createMemo(() => {
    s1();
    return new Promise<number>(res => (resolveAsync = res));
  });

  await createRoot(async () => {
    const value = createMemo(() => `v${s1()}`);
    createRenderEffect(
      () => value(),
      v => {
        if (v !== undefined) observe(v);
      }
    );

    flush();
    resolveAsync(1);
    await Promise.resolve();
    flush();

    // Transition: write the async driver; commit happens once it resolves.
    setS1(2);
    flush();

    resolveAsync(2);
    await Promise.resolve();
    flush();
    await Promise.resolve();
    flush();
  });
}

it("sync wrapper receives the committing transition and drives render effects", async () => {
  const calls: number[] = [];
  const observed: string[] = [];

  setTransitionCommitWrapper((applyMutations, transition) => {
    calls.push(1);
    expect(transition).toBeTruthy();
    applyMutations(); // run synchronously, as a no-native-support fallback would
  });

  await runCommittingTransition(v => observed.push(v));

  // The wrapper fired at least once (on the transition commit) and the render
  // effect ran through `applyMutations`, so the committed value is observed.
  expect(calls.length).toBeGreaterThan(0);
  expect(observed.at(-1)).toBe("v2");
});

it("async wrapper defers render effects until it settles", async () => {
  let release: (() => void) | null = null;
  let runs = 0;

  setTransitionCommitWrapper((applyMutations, _transition) => {
    // Emulate document.startViewTransition: the browser invokes the update
    // callback (our mutations) inside an async gap. Hold it until released.
    return new Promise<void>(resolve => {
      release = () => {
        runs++; // count how many times mutations were applied
        applyMutations(); // DOM mutation happens inside the "update callback"
        resolve();
      };
    });
  });

  await runCommittingTransition(() => {});

  // The async wrapper is pending: mutations have NOT been applied yet, and
  // `_running` is held so re-entrant flushes are no-ops (no spin / deadlock).
  expect(release).toBeTypeOf("function");
  expect(runs).toBe(0);
  flush(); // re-entrant while wrapper pending → must be a safe no-op
  expect(runs).toBe(0);

  // Release the "view transition": mutations apply once, the promise settles,
  // and settle() releases `_running` + re-drains any gap work.
  release!();
  await Promise.resolve();
  flush();

  expect(runs).toBe(1);
});
