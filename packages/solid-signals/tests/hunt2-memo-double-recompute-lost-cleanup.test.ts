import {
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  flush,
  onCleanup
} from "../src/index.js";

/**
 * PROBE: when a memo is recomputed twice within a single flush (the second
 * recompute triggered by an `ownedWrite` performed by a higher computation),
 * `recompute` (src/core/core.ts:186-191) blindly overwrites
 * `_pendingDisposal` / `_pendingFirstChild` with the current `_disposal` /
 * `_firstChild`. The stash from the FIRST recompute of the flush — i.e. the
 * cleanups and children of the run that existed BEFORE the flush — is lost:
 * those onCleanup callbacks never fire and those children are never disposed.
 */

it("every superseded run's onCleanup fires when a memo recomputes twice in one flush", () => {
  const [a, setA] = createSignal(0);
  const [b, setB] = createSignal(0, { ownedWrite: true });
  const cleanups: string[] = [];
  let run = 0;

  createRoot(() => {
    const m = createMemo(() => {
      a();
      b();
      const id = run++;
      onCleanup(() => cleanups.push(`run${id}`));
      return id;
    });
    // Higher computation that writes `b` during the flush, re-dirtying `m`
    // after `m` already recomputed once in the same flush.
    const w = createMemo(() => {
      m();
      setB(a());
      return a();
    });
    createEffect(
      () => (m(), w()),
      () => {}
    );
  });
  flush();
  expect(run).toBe(1);
  expect(cleanups).toEqual([]);

  setA(1);
  flush();

  // m ran twice inside this flush (run1 before w wrote b, run2 after).
  expect(run).toBe(3);
  // Both superseded runs (run0 and run1) must have been cleaned up.
  expect(cleanups.slice().sort()).toEqual(["run0", "run1"]);
});

it("control: cleanups all fire when the recomputes happen in separate flushes", () => {
  const [a, setA] = createSignal(0);
  const cleanups: string[] = [];
  let run = 0;

  createRoot(() => {
    const m = createMemo(() => {
      a();
      const id = run++;
      onCleanup(() => cleanups.push(`run${id}`));
      return id;
    });
    createEffect(m, () => {});
  });
  flush();

  setA(1);
  flush();
  setA(2);
  flush();

  expect(run).toBe(3);
  expect(cleanups.slice().sort()).toEqual(["run0", "run1"]);
});
