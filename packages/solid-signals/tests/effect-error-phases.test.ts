/**
 * Pins the error-handling contract of createEffect's two phases (#2839).
 *
 * Compute phase — reactivity errors (the compute function or upstream sources):
 *   - no `error` handler: logged, the run is skipped, the app keeps going.
 *     A non-render effect's reactivity failing does not crash the system.
 *   - with an EffectBundle `error` handler: the handler receives the error.
 *   - rethrowing from the handler escalates: nearest error boundary, else halt.
 *
 * Effect phase — the user's own imperative code:
 *   - NOT routed to the bundle's `error` handler; handle with try/catch.
 *   - uncaught: nearest error boundary, else the system halts loudly.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEffect,
  createErrorBoundary,
  createRenderEffect,
  createRoot,
  createSignal,
  flush
} from "../src/index.js";

describe("createEffect error phases (#2839)", () => {
  let errorSpy!: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("compute-phase throw with no handler: logged, run skipped, system alive", () => {
    const log: string[] = [];
    const [beat, setBeat] = createSignal(0);
    const [armed, setArmed] = createSignal(false);

    createRoot(() => {
      createRenderEffect(beat, v => {
        log.push(`beat=${v}`);
      });
      createEffect(
        () => {
          if (armed()) throw new Error("boom-compute");
          return 0;
        },
        () => {
          log.push("effect ran");
        }
      );
    });
    flush();
    expect(log).toEqual(["beat=0", "effect ran"]);
    log.length = 0;

    expect(() => {
      setArmed(true);
      flush();
    }).not.toThrow();
    // Logged, effect skipped its run, nothing halted
    expect(errorSpy).toHaveBeenCalledWith(expect.objectContaining({ message: "boom-compute" }));
    expect(log).toEqual([]);

    setBeat(1);
    flush();
    expect(log).toEqual(["beat=1"]);
  });

  it("compute-phase throw with EffectBundle handler: handler receives it, no log", () => {
    const log: string[] = [];
    const [armed, setArmed] = createSignal(false);

    createRoot(() => {
      createEffect(
        () => {
          if (armed()) throw new Error("boom-compute");
          return 0;
        },
        {
          effect: () => {},
          error: err => {
            log.push(`handler: ${(err as Error).message}`);
          }
        }
      );
    });
    flush();

    setArmed(true);
    flush();
    expect(log).toEqual(["handler: boom-compute"]);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("handler receives the thrown error's identity, not the internal wrapper (#2840)", () => {
    class MyError extends Error {}
    const boom = new MyError("boom-identity");
    const [armed, setArmed] = createSignal(false);
    let received: unknown;

    createRoot(() => {
      createEffect(
        () => {
          if (armed()) throw boom;
          return 0;
        },
        {
          effect: () => {},
          error: err => {
            received = err;
          }
        }
      );
    });
    flush();

    setArmed(true);
    flush();
    // The exact object the user threw — instanceof works, no StatusError
    // wrapper, no internal `.source`, matching createErrorBoundary's fallback.
    expect(received).toBe(boom);
    expect(received).toBeInstanceOf(MyError);
    expect(received && typeof received === "object" && "source" in received).toBe(false);
  });

  it("unhandled compute-phase error is logged unwrapped (#2840)", () => {
    class MyError extends Error {}
    const boom = new MyError("boom-log");
    const [armed, setArmed] = createSignal(false);

    createRoot(() => {
      createEffect(
        () => {
          if (armed()) throw boom;
          return 0;
        },
        () => {}
      );
    });
    flush();

    setArmed(true);
    flush();
    expect(errorSpy).toHaveBeenCalledWith(boom);
  });

  it("handler rethrow escalates to the nearest error boundary", () => {
    const log: string[] = [];
    const [armed, setArmed] = createSignal(false);

    createRoot(() => {
      const boundary = createErrorBoundary(
        () => {
          createEffect(
            () => {
              if (armed()) throw new Error("boom-compute");
              return 0;
            },
            {
              effect: () => {},
              error: err => {
                log.push("handler saw it");
                throw err;
              }
            }
          );
          return "content";
        },
        err => `fallback:${(err as () => Error)().message}`
      );
      createRenderEffect(boundary, v => {
        log.push(String(v));
      });
    });
    flush();
    expect(log).toEqual(["content"]);
    log.length = 0;

    setArmed(true);
    flush();
    expect(log).toEqual(["handler saw it", "fallback:boom-compute"]);
  });

  it("effect-phase throw is NOT routed to the bundle handler; boundary catches it", () => {
    const log: string[] = [];
    const [armed, setArmed] = createSignal(false);

    createRoot(() => {
      const boundary = createErrorBoundary(
        () => {
          createEffect(armed, {
            effect: on => {
              if (on) throw new Error("boom-effect");
            },
            error: err => {
              log.push(`handler: ${(err as Error).message}`);
            }
          });
          return "content";
        },
        err => `fallback:${(err as () => Error)().message}`
      );
      createRenderEffect(boundary, v => {
        log.push(String(v));
      });
    });
    flush();
    expect(log).toEqual(["content"]);
    log.length = 0;

    setArmed(true);
    flush();
    // The per-effect handler is for compute-phase (reactivity) errors only;
    // the effect body is the user's own imperative code.
    expect(log).toEqual(["fallback:boom-effect"]);
  });

  it("effect-phase throw with no boundary halts the system loudly", () => {
    const log: string[] = [];
    const [beat, setBeat] = createSignal(0);
    const [armed, setArmed] = createSignal(false);

    createRoot(() => {
      createRenderEffect(beat, v => {
        log.push(`beat=${v}`);
      });
      createEffect(armed, {
        effect: on => {
          if (on) throw new Error("boom-effect");
        },
        error: () => {
          log.push("handler must not fire");
        }
      });
    });
    flush();
    log.length = 0;

    expect(() => {
      setArmed(true);
      flush();
    }).toThrow("boom-effect");
    expect(log).toEqual([]);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("REACTIVITY_HALTED"));

    setBeat(1);
    flush();
    expect(log).toEqual([]);
  });
});
