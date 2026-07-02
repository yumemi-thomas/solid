import { createEffect, createRenderEffect, createRoot, createSignal, flush } from "../src/index.js";
import { globalQueue } from "../src/core/scheduler.js";

afterEach(() => flush());

describe("scheduler hygiene around throwing effects", () => {
  it("balances syncDepth when an effect throws inside flush(fn)", async () => {
    const [a, setA] = createSignal(0);
    const [c, setC] = createSignal(0);
    const seenC: number[] = [];

    createRoot(() => {
      // Throws without writing a signal, so the drain leaves no pending work —
      // this isolates the syncDepth leak from any stuck-`scheduled` symptom.
      createEffect(a, v => {
        if (v === 1) throw new Error("boom");
      });
      createEffect(c, v => {
        seenC.push(v);
      });
    });
    flush();
    // Drain the microtask queued by effect creation; a leftover microtask would
    // otherwise mask a leaked syncDepth by draining the work for us.
    await Promise.resolve();
    seenC.length = 0;

    expect(() => flush(() => setA(1))).toThrow("boom");

    // A clean write must still schedule a microtask. If the throw above leaked
    // syncDepth, `schedule()` would never queue one again and this would stall.
    setC(3);
    await Promise.resolve();
    await Promise.resolve();
    expect(seenC).toEqual([3]);
  });

  it("recovers scheduling when an effect writes a signal and then throws (#2761)", async () => {
    const [a, setA] = createSignal(0);
    const [b, setB] = createSignal(0);
    const [, setC] = createSignal(0);
    const seenB: number[] = [];

    createRoot(() => {
      createEffect(a, v => {
        if (v === 1) {
          setC(100);
          throw new Error("boom");
        }
      });
      createEffect(b, v => {
        seenB.push(v);
      });
    });
    flush();
    await Promise.resolve();
    seenB.length = 0;

    expect(() => flush(() => setA(1))).toThrow("boom");

    setB(1);
    await Promise.resolve();
    await Promise.resolve();
    expect(seenB).toEqual([1]);
  });

  it("runs sibling effects queued after a throwing effect (#2762)", () => {
    const [n, setN] = createSignal(0);
    const seen: number[] = [];

    createRoot(() => {
      createEffect(n, v => {
        if (v === 1) throw new Error("boom");
      });
      createEffect(n, v => {
        seen.push(v);
      });
    });
    flush();
    seen.length = 0;

    setN(1);
    expect(() => flush()).toThrow("boom");
    expect(seen).toEqual([1]);

    setN(2);
    flush();
    expect(seen).toEqual([1, 2]);
  });

  it("throws the first error and reports the rest when multiple effects throw", () => {
    const [n, setN] = createSignal(0);
    const seen: number[] = [];
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      createRoot(() => {
        createEffect(n, v => {
          if (v === 1) throw new Error("boom1");
        });
        createEffect(n, v => {
          if (v === 1) throw new Error("boom2");
        });
        createEffect(n, v => {
          seen.push(v);
        });
      });
      flush();
      seen.length = 0;

      setN(1);
      expect(() => flush()).toThrow("boom1");
      expect(seen).toEqual([1]);
      expect(consoleError).toHaveBeenCalledWith(expect.objectContaining({ message: "boom2" }));
    } finally {
      consoleError.mockRestore();
    }
  });

  it("still runs user effects when a render effect throws", () => {
    const [n, setN] = createSignal(0);
    const seen: number[] = [];

    createRoot(() => {
      createRenderEffect(n, v => {
        if (v === 1) throw new Error("render boom");
      });
      createEffect(n, v => {
        seen.push(v);
      });
    });
    flush();
    seen.length = 0;

    setN(1);
    expect(() => flush()).toThrow("render boom");
    expect(seen).toEqual([1]);
  });

  it("completes the drain when a render effect's compute throws during the heap phase", async () => {
    const [n, setN] = createSignal(0);
    const [b, setB] = createSignal(0);
    const seen: number[] = [];

    createRoot(() => {
      createRenderEffect(
        () => {
          if (n() === 1) throw new Error("compute boom");
        },
        () => {}
      );
      createEffect(b, v => {
        seen.push(v);
      });
    });
    flush();
    await Promise.resolve();
    seen.length = 0;

    expect(() =>
      flush(() => {
        setN(1);
        setB(1);
      })
    ).toThrow("compute boom");
    expect(seen).toEqual([1]);

    setB(2);
    await Promise.resolve();
    await Promise.resolve();
    expect(seen).toEqual([1, 2]);
  });

  it("self-heals when the drain itself aborts", async () => {
    const [b, setB] = createSignal(0);
    const seen: number[] = [];

    createRoot(() => {
      createEffect(b, v => {
        seen.push(v);
      });
    });
    flush();
    await Promise.resolve();
    seen.length = 0;

    let explode = true;
    const badChild = {
      _parent: null,
      _children: [],
      created: 0,
      enqueue() {},
      run() {
        if (explode) {
          explode = false;
          throw new Error("internal abort");
        }
      },
      addChild() {},
      removeChild() {},
      notify: () => false,
      stashQueues() {},
      restoreQueues() {}
    };
    globalQueue.addChild(badChild as any);

    try {
      expect(() => flush(() => setB(1))).toThrow("internal abort");

      await Promise.resolve();
      await Promise.resolve();
      expect(seen).toEqual([1]);

      setB(2);
      await Promise.resolve();
      await Promise.resolve();
      expect(seen).toEqual([1, 2]);
    } finally {
      globalQueue.removeChild(badChild as any);
    }
  });
});

it("should batch updates", () => {
  const [$x, setX] = createSignal(10);
  const effect = vi.fn();

  createRoot(() => createEffect($x, effect));
  flush();

  setX(20);
  setX(30);
  setX(40);

  expect(effect).to.toHaveBeenCalledTimes(1);
  flush();
  expect(effect).to.toHaveBeenCalledTimes(2);
});

it("should wait for queue to flush", () => {
  const [$x, setX] = createSignal(10);
  const $effect = vi.fn();

  createRoot(() => createEffect($x, $effect));
  flush();

  expect($effect).to.toHaveBeenCalledTimes(1);

  setX(20);
  flush();
  expect($effect).to.toHaveBeenCalledTimes(2);

  setX(30);
  flush();
  expect($effect).to.toHaveBeenCalledTimes(3);
});

it("should not fail if called while flushing", () => {
  const [$a, setA] = createSignal(10);

  const effect = vi.fn(() => {
    flush();
  });

  createRoot(() => createEffect($a, effect));
  flush();

  expect(effect).to.toHaveBeenCalledTimes(1);

  setA(20);
  flush();
  expect(effect).to.toHaveBeenCalledTimes(2);
});

it("should run callback and flush before returning", () => {
  const [$x, setX] = createSignal(10);
  const effect = vi.fn();

  createRoot(() => createEffect($x, effect));
  flush();

  const result = flush(() => {
    setX(20);
    expect(effect).to.toHaveBeenCalledTimes(1);
    return "done";
  });

  expect(result).toBe("done");
  expect(effect).to.toHaveBeenCalledTimes(2);
});

it("nested flush(fn) drains at each level", () => {
  const [$x, setX] = createSignal(10);
  const [$y, setY] = createSignal(10);
  const effect = vi.fn();

  createRoot(() => createEffect(() => [$x(), $y()], effect));
  flush();

  flush(() => {
    setX(20);
    expect(effect).to.toHaveBeenCalledTimes(1);

    const inner = flush(() => {
      setY(30);
      expect(effect).to.toHaveBeenCalledTimes(1);
      return 1;
    });

    expect(inner).toBe(1);
    // Inner flush drained, so effect already saw [20, 30].
    expect(effect).to.toHaveBeenCalledTimes(2);
  });

  // Outer flush drain finds nothing pending — no extra call.
  expect(effect).to.toHaveBeenCalledTimes(2);
});
