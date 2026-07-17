import { afterEach, describe, expect, test, vi } from "vitest";
import { $$component, $$decline, $$refresh, $$registry } from "../src/refresh/index.js";

// Force the production guard: the refresh runtime keys off the same IS_DEV
// constant the rest of core uses (replaced at build time; mocked here).
vi.mock(import("../src/client/core.js"), async importOriginal => {
  const original = await importOriginal();
  return { ...original, IS_DEV: false };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("production-mode guard", () => {
  test("$$component returns the component unwrapped", () => {
    const registry = $$registry();
    const Component = () => null;
    const result = $$component(registry, "Component", Component as any);
    expect(result).toBe(Component);
  });

  test("$$refresh is inert and warns once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const accept = vi.fn();
    const invalidate = vi.fn();
    const hot = { data: {}, accept, invalidate, decline: vi.fn() };

    $$refresh("vite", hot as any, $$registry());
    $$decline("vite", hot as any, true);

    expect(accept).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
