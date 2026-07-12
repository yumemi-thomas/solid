import {
  createEffect,
  createLoadingBoundary,
  createRoot,
  createSignal,
  flush
} from "../src/index.js";

/**
 * PROBE: `Queue.run` (src/core/scheduler.ts:341-348) iterates `_children` by
 * index while effects run. When an effect inside boundary A disposes A,
 * `removeChild` splices A's queue out of the parent's `_children`, shifting
 * sibling boundary B's queue into the slot the loop already passed. B's
 * queued effects are skipped for this flush AND no new flush is scheduled —
 * they sit in B's queue until some unrelated write triggers another flush.
 */

it("disposing a boundary from one of its own effects does not skip a sibling boundary's effects", () => {
  const [s, setS] = createSignal(0);
  const log: string[] = [];
  let disposeA!: () => void;

  createRoot(() => {
    createRoot(d => {
      disposeA = d;
      createLoadingBoundary(
        () => {
          createEffect(s, v => {
            log.push(`a${v}`);
            if (v === 1) disposeA();
          });
          return "A";
        },
        () => "loadingA"
      );
    });
    createLoadingBoundary(
      () => {
        createEffect(s, v => {
          log.push(`b${v}`);
        });
        return "B";
      },
      () => "loadingB"
    );
  });
  flush();
  expect(log).toContain("a0");
  expect(log).toContain("b0");

  setS(1);
  flush();

  // Boundary B's effect must still observe v === 1 in this flush.
  expect(log).toContain("b1");
});
