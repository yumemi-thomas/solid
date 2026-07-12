import { createEffect, createMemo, createRoot, createSignal, flush } from "../src/index.js";

/**
 * PROBE: a memo that errored and then recomputes successfully to a value
 * `equals` to its previous value never notifies subscribers that the error
 * cleared. `recompute` (src/core/core.ts:302-358) only calls `insertSubs`
 * when `valueChanged`; the error->ok status transition itself does not
 * propagate (there is no error analog of `settlePendingSource`). Downstream
 * memos/effects stay stuck in STATUS_ERROR with the stale error.
 */

class Boom extends Error {}

it("effect recovers when an errored memo heals to a value equal to its last value", () => {
  const [s, setS] = createSignal(1);
  const values: string[] = [];
  const errors: unknown[] = [];

  createRoot(() => {
    const m = createMemo(() => {
      if (s() === 2) throw new Boom("boom");
      return "constant";
    });
    createEffect(m, {
      effect: v => {
        values.push(v);
      },
      error: err => {
        errors.push(err);
      }
    });
  });
  flush();
  expect(values).toEqual(["constant"]);

  setS(2);
  flush();
  expect(errors.length).toBe(1);

  setS(1); // memo recomputes fine, value === previous value
  flush();

  // The error state cleared — the effect must observe the recovery.
  expect(values).toEqual(["constant", "constant"]);
});

it("untracked read of a downstream memo returns the healed value (not the stale error)", () => {
  const [s, setS] = createSignal(1);
  let chained!: () => string;

  createRoot(() => {
    const m = createMemo(() => {
      if (s() === 2) throw new Boom("boom");
      return "constant";
    });
    chained = createMemo(() => m());
    createEffect(chained, { effect: () => {}, error: () => {} });
  });
  flush();
  expect(chained()).toBe("constant");

  setS(2);
  flush();

  setS(1); // heals with an equal value
  flush();

  // ACTUAL while bug exists: throws the stale Boom captured before the heal.
  expect(chained()).toBe("constant");
});

it("control: effect recovers when the memo heals to a different value", () => {
  const [s, setS] = createSignal(1);
  const values: string[] = [];
  const errors: unknown[] = [];

  createRoot(() => {
    const m = createMemo(() => {
      if (s() === 2) throw new Boom("boom");
      return `v${s()}`;
    });
    createEffect(m, {
      effect: v => {
        values.push(v);
      },
      error: err => {
        errors.push(err);
      }
    });
  });
  flush();

  setS(2);
  flush();
  expect(errors.length).toBe(1);

  setS(3); // heals with a different value
  flush();

  expect(values).toEqual(["v1", "v3"]);
});
