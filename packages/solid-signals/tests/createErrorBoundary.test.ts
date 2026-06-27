import {
  action,
  createEffect,
  createErrorBoundary,
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  untrack
} from "../src/index.js";

it("should let errors bubble up when not handled", () => {
  const error = new Error();
  let caught: any;
  try {
    createRoot(() => {
      createRenderEffect(
        () => {
          throw error;
        },
        () => {}
      );
    });
    flush();
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeDefined();
  expect(caught.cause ?? caught).toBe(error);
});

it("should handle error", () => {
  const error = new Error();

  const b = createRoot(() =>
    createErrorBoundary(
      () => {
        throw error;
      },
      () => "errored"
    )
  );

  expect(b()).toBe("errored");
});

it("should forward error to another handler", () => {
  const error = new Error();

  const b = createRoot(() =>
    createErrorBoundary(
      () => {
        const inner = createErrorBoundary(
          () => {
            throw error;
          },
          e => {
            expect(e()).toBe(error);
            throw e();
          }
        );
        createRenderEffect(inner, () => {});
      },
      () => "errored"
    )
  );

  expect(b()).toBe("errored");
});

it("should not duplicate error handler", () => {
  const error = new Error(),
    handler = vi.fn((_: unknown) => "errored");

  let [$x, setX] = createSignal(0),
    shouldThrow = false;

  createRoot(() => {
    const b = createErrorBoundary(
      () => {
        $x();
        if (shouldThrow) throw error;
      },
      err => handler(err())
    );
    createRenderEffect(b, () => {});
  });

  setX(1);
  flush();

  shouldThrow = true;
  setX(2);
  flush();
  expect(handler).toHaveBeenCalledTimes(1);
});

it("should not trigger wrong handler", () => {
  const error = new Error(),
    rootHandler = vi.fn((_: unknown) => "errored"),
    handler = vi.fn((_: unknown) => "errored");

  let [$x, setX] = createSignal(0),
    shouldThrow = false;

  createRoot(() => {
    const b = createErrorBoundary(
      () => {
        createRenderEffect(
          () => {
            $x();
            if (shouldThrow) throw error;
          },
          () => {}
        );

        const b2 = createErrorBoundary(
          () => {
            // no-op
          },
          err => handler(err())
        );
        createRenderEffect(b2, () => {});
      },
      err => rootHandler(err())
    );
    createRenderEffect(b, () => {});
  });

  expect(rootHandler).toHaveBeenCalledTimes(0);
  shouldThrow = true;
  setX(1);
  flush();

  expect(rootHandler).toHaveBeenCalledTimes(1);
  expect(handler).not.toHaveBeenCalledWith(error);
});

it("should throw error if there are no handlers left", () => {
  const error = new Error(),
    handler = vi.fn(e => {
      throw e();
    });

  createRoot(() => {
    let caught: any;
    try {
      createErrorBoundary(() => {
        createErrorBoundary(() => {
          throw error;
        }, handler)();
      }, handler)();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeDefined();
    expect(caught.cause ?? caught).toBe(error);
  });

  expect(handler).toHaveBeenCalledTimes(2);
});

it("should handle errors when the effect is on the outside", async () => {
  const error = new Error(),
    rootHandler = vi.fn();

  const [$x, setX] = createSignal(0);

  createRoot(() => {
    const b = createErrorBoundary(
      () => {
        if ($x()) throw error;
        createErrorBoundary(
          () => {
            throw error;
          },
          e => {
            expect(e()).toBe(error);
          }
        );
      },
      err => rootHandler(err())
    );
    createRenderEffect(
      () => b(),
      () => {}
    );
  });
  expect(rootHandler).toHaveBeenCalledTimes(0);
  setX(1);
  flush();
  expect(rootHandler).toHaveBeenCalledWith(error);
  expect(rootHandler).toHaveBeenCalledTimes(1);
});

it("should handle errors when the effect is on the outside and memo in the middle", async () => {
  const error = new Error(),
    rootHandler = vi.fn((_: unknown) => "errored");

  createRoot(() => {
    const b = createErrorBoundary(
      () =>
        createMemo(() => {
          throw error;
        }),
      err => rootHandler(err())
    );
    createRenderEffect(b, () => {});
  });
  expect(rootHandler).toHaveBeenCalledTimes(1);
});

it("should hold error boundary during transition when signal change clears error", async () => {
  const error = new Error("test error");
  const [$shouldError, setShouldError] = createSignal(true);
  let result: any;

  createRoot(() => {
    const b = createErrorBoundary(
      () => {
        if ($shouldError()) throw error;
        return "content";
      },
      () => "error"
    );
    createRenderEffect(
      () => (result = b()),
      () => {}
    );
  });

  flush();
  expect(result).toBe("error");

  // Start a transition that clears the error
  const myAction = action(function* () {
    setShouldError(false);
    yield Promise.resolve();
  });

  myAction();
  flush();
  // Transition in progress - boundary should still show error (held)
  expect(result).toBe("error");

  await Promise.resolve();
  // Transition complete - boundary should now show content
  expect(result).toBe("content");
});

it("should hold error boundary during transition when reset is called", async () => {
  const error = new Error("test error");
  let shouldError = true;
  let result: any;
  let resetFn!: () => void;

  createRoot(() => {
    const b = createErrorBoundary(
      () => {
        if (shouldError) throw error;
        return "content";
      },
      (err, reset) => {
        resetFn = reset;
        return "error";
      }
    );
    createRenderEffect(
      () => (result = b()),
      () => {}
    );
  });

  flush();
  expect(result).toBe("error");
  expect(resetFn).toBeDefined();

  // Start a transition that resets the error boundary
  const myAction = action(function* () {
    shouldError = false;
    resetFn();
    yield Promise.resolve();
  });

  myAction();
  flush();
  // Transition in progress - boundary should still show error (held)
  expect(result).toBe("error");

  await Promise.resolve();
  // Transition complete - boundary should now show content
  expect(result).toBe("content");
});

it("should catch errors thrown in render effect callbacks (back half)", () => {
  const error = new Error("effect callback error");
  const handler = vi.fn();

  createRoot(() => {
    const b = createErrorBoundary(
      () => {
        createRenderEffect(
          () => "value",
          () => {
            throw error;
          }
        );
        return "content";
      },
      err => {
        handler(err());
        return "errored";
      }
    );
    createRenderEffect(b, () => {});
  });

  flush();
  expect(handler).toHaveBeenCalledTimes(1);
  expect(handler).toHaveBeenCalledWith(error);
});

it("should catch errors thrown in user effect callbacks (back half)", () => {
  const error = new Error("user effect callback error");
  const handler = vi.fn();
  let result: any;

  createRoot(() => {
    const b = createErrorBoundary(
      () => {
        createEffect(
          () => "value",
          () => {
            throw error;
          }
        );
        return "content";
      },
      err => {
        handler(err());
        return "errored";
      }
    );
    createRenderEffect(
      () => (result = b()),
      () => {}
    );
  });

  flush();
  expect(handler).toHaveBeenCalledTimes(1);
  expect(handler).toHaveBeenCalledWith(error);
  expect(result).toBe("errored");
});

it("should catch errors thrown in user effect callbacks with error handler (back half)", () => {
  const error = new Error("user effect bundle error");
  const handler = vi.fn();
  const errorHandler = vi.fn();
  let result: any;

  createRoot(() => {
    const b = createErrorBoundary(
      () => {
        createEffect(() => "value", {
          effect: () => {
            throw error;
          },
          error: errorHandler
        });
        return "content";
      },
      err => {
        handler(err());
        return "errored";
      }
    );
    createRenderEffect(
      () => (result = b()),
      () => {}
    );
  });

  flush();
  expect(handler).toHaveBeenCalledTimes(1);
  expect(handler).toHaveBeenCalledWith(error);
  expect(result).toBe("errored");
});

it("should recover from effect callback error after reset", () => {
  const error = new Error("effect callback error");
  let shouldThrow = true;
  let result: any;
  let resetFn!: () => void;

  createRoot(() => {
    const b = createErrorBoundary(
      () => {
        createRenderEffect(
          () => "value",
          () => {
            if (shouldThrow) throw error;
          }
        );
        return "content";
      },
      (err, reset) => {
        resetFn = reset;
        return "errored";
      }
    );
    createRenderEffect(
      () => (result = b()),
      () => {}
    );
  });

  flush();
  expect(result).toBe("errored");
  expect(resetFn).toBeDefined();

  shouldThrow = false;
  resetFn();
  flush();
  expect(result).toBe("content");
});

it("should throw effect callback errors when no boundary exists", () => {
  const error = new Error("uncaught effect error");

  expect(() => {
    createRoot(() => {
      createRenderEffect(
        () => "value",
        () => {
          throw error;
        }
      );
    });
    flush();
  }).toThrowError(error);
});

it("should recover when async memo errors then dependency changes and boundary resets", async () => {
  const [$id, setId] = createSignal("bad");
  let result: any;
  let resetFn!: () => void;

  createRoot(() => {
    const data = createMemo(async () => {
      const id = $id();
      await Promise.resolve();
      if (id !== "1") throw new Error(`Item ${id} not found`);
      return { title: "Test Item" };
    });

    const boundary = createErrorBoundary(
      () =>
        createLoadingBoundary(
          () => data().title,
          () => "loading"
        )(),
      (err, reset) => {
        resetFn = reset;
        return "error: " + (err() as Error).message;
      }
    );

    createRenderEffect(
      () => (result = boundary()),
      () => {}
    );
  });

  flush();
  await Promise.resolve();
  await Promise.resolve();
  flush();
  expect(result).toBe("error: Item bad not found");

  setId("1");
  resetFn();
  flush();

  await Promise.resolve();
  await Promise.resolve();
  flush();
  expect(result).toBe("Test Item");
});

it("should recover when sync memo errors then dependency changes and boundary resets", () => {
  const [$id, setId] = createSignal("bad");
  let result: any;
  let resetFn!: () => void;

  createRoot(() => {
    const data = createMemo(() => {
      const id = $id();
      if (id !== "1") throw new Error(`Item ${id} not found`);
      return "ok";
    });

    const boundary = createErrorBoundary(
      () => data(),
      (err, reset) => {
        resetFn = reset;
        return "error";
      }
    );

    createRenderEffect(
      () => (result = boundary()),
      () => {}
    );
  });

  flush();
  expect(result).toBe("error");

  setId("1");
  resetFn();
  flush();
  expect(result).toBe("ok");
});

it("should not infinite loop when errored async memo is heap-queued and then re-read", async () => {
  const [$id, setId] = createSignal("bad");
  let result: any;
  let resetFn!: () => void;

  createRoot(() => {
    const data = createMemo(async () => {
      const id = $id();
      await Promise.resolve();
      if (id !== "1") throw new Error("not found");
      return "resolved";
    });

    const boundary = createErrorBoundary(
      () =>
        createLoadingBoundary(
          () => data(),
          () => "loading"
        )(),
      (err, reset) => {
        resetFn = reset;
        return "error";
      }
    );

    createRenderEffect(
      () => (result = boundary()),
      () => {}
    );
  });

  flush();
  await Promise.resolve();
  await Promise.resolve();
  flush();
  expect(result).toBe("error");

  // Signal change queues the memo in the dirty heap, then reset triggers re-read.
  // Before the fix, this caused an infinite loop in runHeap because the memo's
  // IN_HEAP flag was cleared by updateIfNecessary but the node was still in the
  // physical heap, and recompute(el, true) skipped deleteFromHeap.
  setId("1");
  resetFn();
  flush();

  await Promise.resolve();
  await Promise.resolve();
  flush();
  expect(result).toBe("resolved");
});

/**
 * #2790: `isPending(data)` inside a `<Show>`-shaped condition in an `<Errored>`
 * fallback, where the async `data` fails again after `reset()`.
 *
 * The fix has three layered, orthogonal parts:
 *
 *   1. Async propagation: the link an `isPending` read creates is tagged as a
 *      pending-observer; on a STATUS_ERROR notification `notifyStatus` re-runs the
 *      reader (so `isPending` re-evaluates to not-pending) instead of forwarding
 *      the error, which would otherwise escape the fallback (a boundary cannot
 *      catch an error from its own fallback) as an unhandled rejection. The
 *      end-to-end rejection assertion lives in the matching solid-web test.
 *
 *   2. `isPending` probe observation: `read`'s errored-retry is gated behind
 *      `!pendingCheckActive`. The real #2790 read is owned/tracked, so this is the
 *      load-bearing gate there — a pending-check observes the errored status
 *      (throws the stored error, which `isPending` swallows -> `false`) and never
 *      re-fetches. Handling this in `isPending`'s catch instead does NOT work: the
 *      re-fetch happens during the read, before the catch runs, so the source is
 *      already pending again and `isPending` would return `true`.
 *
 *   3. Owned-scope retry policy: `read`'s errored-retry is additionally gated
 *      behind `tracking`. An errored async source only retries when re-read from
 *      an owned/tracked scope (a reactive recomputation) in a later cycle. A
 *      naked/ownerless read — events, `untrack`, an effect's side-effect phase —
 *      surfaces the stored error without re-fetching.
 *
 * Combined retry condition in `read`: `tracking && !pendingCheckActive && el._time < clock`.
 */
it("isPending inside Loading > Errored fallback does not loop when the source re-errors after reset (#2790)", async () => {
  function deferred<T = void>() {
    let resolve!: (value: T) => void;
    let reject!: (error?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  // Mirror solid-js `<Show when={isPending(data)}>` exactly: a `condition value`
  // memo running the `when` expression, a `sync: true` `condition` memo, then the
  // value memo that consumes `condition()`. The intermediate links are normal
  // (untagged); only `data -> condition value` is the pending-observer link.
  function showShaped(when: () => unknown, children: () => unknown) {
    const conditionValue = createMemo(when);
    const condition = createMemo(conditionValue, {
      equals: (a, b) => !a === !b,
      sync: true
    });
    return createMemo(() => (condition() ? untrack(children) : undefined), { sync: true });
  }

  let result: any;
  let resetFn: (() => void) | undefined;
  const [$count, setCount] = createSignal(0);
  let current = deferred<number>();
  let data!: () => number;

  // guard: a runaway re-render of the fallback throws instead of hanging
  let fallbackRuns = 0;

  createRoot(() => {
    data = createMemo(async () => {
      $count();
      await current.promise;
      return 10;
    });

    const boundary = createLoadingBoundary(
      () =>
        createErrorBoundary(
          () => ["data: ", data()],
          (err, reset) => {
            resetFn = reset;
            if (++fallbackRuns > 50) throw new Error("INFINITE_LOOP: fallback ran " + fallbackRuns);
            return [
              "error",
              showShaped(
                () => isPending(data),
                () => " (resetting)"
              )
            ];
          }
        )(),
      () => "loading"
    );

    createRenderEffect(
      () => (result = boundary()),
      () => {}
    );
  });

  flush();
  expect(result).toBe("loading");

  // first failure -> Errored fallback
  current.reject(new Error("boom 1"));
  await Promise.resolve();
  await Promise.resolve();
  flush();
  expect(Array.isArray(result) ? result[0] : result).toBe("error");

  // reset; the refetch fails again
  current = deferred<number>();
  setCount(1);
  resetFn!();
  flush();

  current.reject(new Error("boom 2"));
  await Promise.resolve();
  await Promise.resolve();
  flush();

  expect(fallbackRuns).toBeLessThan(50);
  expect(Array.isArray(result) ? result[0] : result).toBe("error");

  // ASYNC semantic: the `isPending(data)` standing observer in the fallback
  // settled to not-pending (the `showShaped` `when` resolved false), so the
  // "(resetting)" branch is absent — the errored source was swallowed, not
  // forwarded as an error.
  expect(JSON.stringify(result)).not.toContain("resetting");

  // Concern 3 negative path: a naked/untracked `isPending` read of the
  // now-errored source returns false and does not re-fetch. Advance the clock
  // after the error so the source looks stale (el._time < clock) — the case
  // the read-time retry would otherwise fire on. Because the read is untracked
  // (`tracking === false`), the `tracking` gate suppresses the retry: the read
  // surfaces the stored error, which `isPending` swallows -> false.
  setCount(2);
  flush();
  let syncThrew = false;
  let syncVal: boolean | undefined;
  try {
    syncVal = untrack(() => isPending(() => data()));
  } catch {
    syncThrew = true;
  }
  expect(syncThrew).toBe(false);
  expect(syncVal).toBe(false);

  // Concern 3 positive path: the `tracking` gate must not break legitimate
  // recovery. A dependency change + reset, with the refetch now succeeding,
  // recovers through the boundary's tracked read.
  current = deferred<number>();
  setCount(3);
  resetFn!();
  flush();
  current.resolve(10);
  await Promise.resolve();
  await Promise.resolve();
  flush();
  expect(result).toEqual(["data: ", 10]);
});
