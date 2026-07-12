import { createEffect, createRoot, createSignal, flush } from "../src/index.js";

/**
 * PROBE: `runQueue` (src/core/scheduler.ts:797-799) runs the flushed effect
 * callbacks with no per-callback isolation, and the queue array was already
 * detached (`this._queues[type-1] = []`) before running. An unhandled throw
 * from one user effect therefore aborts the loop and PERMANENTLY drops every
 * later queued effect for that flush — they are not retried on the next
 * flush because their nodes were already recomputed.
 */

it("an unhandled throw in one user effect does not drop sibling effects queued in the same flush", () => {
  const [s, setS] = createSignal(0);
  const log: number[] = [];

  createRoot(() => {
    createEffect(s, v => {
      if (v === 1) throw new Error("boom");
    });
    createEffect(s, v => {
      log.push(v);
    });
  });
  flush();
  expect(log).toEqual([0]);

  setS(1);
  try {
    flush();
  } catch {
    /* the unhandled effect error is expected to propagate */
  }

  // The sibling effect must still have observed v === 1.
  expect(log).toEqual([0, 1]);
});
