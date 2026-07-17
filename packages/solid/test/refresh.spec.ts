import { afterEach, describe, expect, test, vi } from "vitest";
import { createComponent, createRoot, createSignal, flush } from "../src/index.js";
import {
  $$component,
  $$decline,
  $$refresh,
  $$registry,
  configureRefresh,
  type Registry
} from "../src/refresh/index.js";

interface CounterInstance {
  version: number;
  count: () => number;
  setCount: (v: number) => void;
}

function makeCounter(version: number, onRender?: () => void) {
  return () => {
    onRender?.();
    const [count, setCount] = createSignal(0);
    return { version, count, setCount } as unknown as CounterInstance;
  };
}

/** Minimal mock of Vite's import.meta.hot surface used by the runtime. */
function createViteHot() {
  const data: Record<string, any> = {};
  const invalidate = vi.fn();
  const decline = vi.fn();
  let acceptCallback: ((mod?: unknown) => void) | undefined;
  return {
    hot: {
      data,
      accept: (cb: (mod?: unknown) => void) => {
        acceptCallback = cb;
      },
      invalidate,
      decline
    },
    data,
    invalidate,
    decline,
    fireAccept(mod?: unknown) {
      acceptCallback!(mod);
    }
  };
}

/** Simulates one execution of a compiled module body. */
function executeModule(
  hot: ReturnType<typeof createViteHot>["hot"],
  components: Record<string, { impl: (props: any) => any; options?: Record<string, any> }>
) {
  const registry = $$registry();
  const proxies: Record<string, (props: any) => any> = {};
  for (const [id, { impl, options }] of Object.entries(components)) {
    proxies[id] = $$component(registry, id, impl, options);
  }
  $$refresh("vite", hot as any, registry);
  return { registry, proxies };
}

function render(proxy: (props: any) => any): () => CounterInstance {
  let out!: () => CounterInstance;
  createRoot(() => {
    out = createComponent(proxy as any, {}) as unknown as () => CounterInstance;
  });
  return out;
}

afterEach(() => {
  configureRefresh({ invalidate: undefined });
});

describe("$$component proxy swapping (vite mode)", () => {
  test("unchanged signature keeps the mounted component and its reactive state", () => {
    const { hot, fireAccept, invalidate } = createViteHot();
    let renders = 0;
    const first = executeModule(hot, {
      Counter: { impl: makeCounter(1, () => renders++), options: { signature: "sig-a" } }
    });

    const out = render(first.proxies.Counter);
    const instance1 = out();
    expect(renders).toBe(1);
    expect(instance1.version).toBe(1);

    instance1.setCount(5);
    flush();
    expect(instance1.count()).toBe(5);

    // Module re-executes with an identical signature (e.g. a sibling in the
    // same file changed) — the mounted component must not remount.
    executeModule(hot, {
      Counter: { impl: makeCounter(2, () => renders++), options: { signature: "sig-a" } }
    });
    fireAccept({});
    flush();

    const instance2 = out();
    expect(instance2).toBe(instance1);
    expect(renders).toBe(1);
    expect(instance2.count()).toBe(5);
    expect(invalidate).not.toHaveBeenCalled();
  });

  test("changed signature swaps in the new component (remounts, state resets)", () => {
    const { hot, fireAccept, invalidate } = createViteHot();
    const first = executeModule(hot, {
      Counter: { impl: makeCounter(1), options: { signature: "sig-a" } }
    });

    const out = render(first.proxies.Counter);
    out().setCount(5);
    flush();
    expect(out().count()).toBe(5);

    executeModule(hot, {
      Counter: { impl: makeCounter(2), options: { signature: "sig-b" } }
    });
    fireAccept({});
    flush();

    const swapped = out();
    expect(swapped.version).toBe(2);
    expect(swapped.count()).toBe(0);
    expect(invalidate).not.toHaveBeenCalled();
  });

  test("changed dependencies with the same signature also swap", () => {
    const { hot, fireAccept } = createViteHot();
    const first = executeModule(hot, {
      Counter: {
        impl: makeCounter(1),
        options: { signature: "sig-a", dependencies: () => ({ theme: "light" }) }
      }
    });

    const out = render(first.proxies.Counter);
    expect(out().version).toBe(1);

    executeModule(hot, {
      Counter: {
        impl: makeCounter(2),
        options: { signature: "sig-a", dependencies: () => ({ theme: "dark" }) }
      }
    });
    fireAccept({});
    flush();

    expect(out().version).toBe(2);
  });

  test("no signature (non-granular mode) always remounts", () => {
    const { hot, fireAccept } = createViteHot();
    const first = executeModule(hot, { Counter: { impl: makeCounter(1) } });

    const out = render(first.proxies.Counter);
    expect(out().version).toBe(1);

    executeModule(hot, { Counter: { impl: makeCounter(2) } });
    fireAccept({});
    flush();

    expect(out().version).toBe(2);
  });

  test("context identity: symbol id is carried over to the new registration", () => {
    const { hot, fireAccept } = createViteHot();
    const id = Symbol("ctx");
    const oldContext = Object.assign(() => null, { id, defaultValue: undefined });
    const newContext = Object.assign(() => null, { id: Symbol("ctx"), defaultValue: undefined });

    executeModule(hot, { Ctx: { impl: oldContext } });
    executeModule(hot, { Ctx: { impl: newContext } });
    fireAccept({});

    expect(newContext.id).toBe(id);
  });
});

describe("$$refresh registration bookkeeping (vite mode)", () => {
  test("hot.data keeps the first registry across re-executions", () => {
    const { hot, data, fireAccept } = createViteHot();
    const first = executeModule(hot, {
      Counter: { impl: makeCounter(1), options: { signature: "sig-a" } }
    });
    expect(data["solid-refresh"]).toBe(first.registry);
    expect(data["solid-refresh-prev"]).toBe(first.registry);

    const second = executeModule(hot, {
      Counter: { impl: makeCounter(2), options: { signature: "sig-a" } }
    });
    expect(data["solid-refresh"]).toBe(first.registry);
    expect(data["solid-refresh-prev"]).toBe(second.registry);
    fireAccept({});
  });

  test("components added by a re-execution are adopted into the original registry", () => {
    const { hot, fireAccept } = createViteHot();
    const first = executeModule(hot, {
      Counter: { impl: makeCounter(1), options: { signature: "sig-a" } }
    });

    const second = executeModule(hot, {
      Counter: { impl: makeCounter(1), options: { signature: "sig-a" } },
      Extra: { impl: makeCounter(9), options: { signature: "sig-x" } }
    });
    fireAccept({});

    expect(first.registry.components.get("Extra")).toBe(second.registry.components.get("Extra"));
  });

  test("re-executed module renders through the first proxy", () => {
    const { hot, fireAccept } = createViteHot();
    executeModule(hot, {
      Counter: { impl: makeCounter(1), options: { signature: "sig-a" } }
    });

    // Same signature, so the original component stays mounted; the new
    // module's proxy must still render the surviving (v1) registration.
    const second = executeModule(hot, {
      Counter: { impl: makeCounter(2), options: { signature: "sig-a" } }
    });
    fireAccept({});
    flush();

    const out = render(second.proxies.Counter);
    expect(out().version).toBe(1);
  });

  test("removed component invalidates the module", () => {
    const { hot, fireAccept, invalidate } = createViteHot();
    executeModule(hot, {
      Counter: { impl: makeCounter(1), options: { signature: "sig-a" } }
    });

    executeModule(hot, {
      Renamed: { impl: makeCounter(2), options: { signature: "sig-a" } }
    });
    fireAccept({});

    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  test("accept receiving no module namespace invalidates", () => {
    const { hot, fireAccept, invalidate } = createViteHot();
    executeModule(hot, {
      Counter: { impl: makeCounter(1), options: { signature: "sig-a" } }
    });
    fireAccept(undefined);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });
});

describe("$$decline and the injectable invalidation callback", () => {
  test("vite inline decline invalidates immediately", () => {
    const { hot, invalidate } = createViteHot();
    $$decline("vite", hot as any, true);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  test("vite non-inline decline accepts then invalidates", () => {
    const { hot, invalidate, fireAccept } = createViteHot();
    $$decline("vite", hot as any);
    expect(invalidate).not.toHaveBeenCalled();
    fireAccept({});
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  test("standard bail prefers hot.invalidate when nothing is configured", () => {
    const invalidate = vi.fn();
    const hot = { data: {}, accept: vi.fn(), dispose: vi.fn(), invalidate };
    $$decline("standard", hot as any, true);
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  test("configured invalidate callback overrides the default bail behavior", () => {
    const custom = vi.fn();
    const invalidate = vi.fn();
    configureRefresh({ invalidate: custom });

    const hot = { data: {}, accept: vi.fn(), dispose: vi.fn(), invalidate };
    $$decline("standard", hot as any, true);

    expect(custom).toHaveBeenCalledTimes(1);
    expect(custom).toHaveBeenCalledWith(hot);
    expect(invalidate).not.toHaveBeenCalled();
  });

  test("standard-mode patch failure routes through the configured callback", () => {
    const custom = vi.fn();
    configureRefresh({ invalidate: custom });

    // module.hot-style API without invalidate/decline
    let disposeCb: ((data: any) => void) | undefined;
    const makeHot = (data: any) => ({
      data,
      accept: vi.fn(),
      dispose: (cb: (data: any) => void) => {
        disposeCb = cb;
      }
    });

    const registry1 = $$registry();
    $$component(registry1, "Counter", makeCounter(1), { signature: "sig-a" });
    const hot1 = makeHot(undefined);
    $$refresh("standard", hot1 as any, registry1);

    // Simulate the bundler disposing the old module and executing the new one.
    const carried: any = {};
    disposeCb!(carried);

    const registry2 = $$registry();
    $$component(registry2, "Renamed", makeCounter(2), { signature: "sig-a" });
    const hot2 = makeHot(carried);
    $$refresh("standard", hot2 as any, registry2);

    expect(custom).toHaveBeenCalledTimes(1);
  });
});
