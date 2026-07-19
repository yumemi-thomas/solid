/**
 * @vitest-environment jsdom
 */

// Regression coverage for #2920: a server-rendered lazy() component's chunk
// is dynamically imported while hydration is active, so its compiled
// module-scope `$$component(REGISTRY, "Name", ...)` registration runs with
// `sharedConfig.hydrating === true` and no reactive owner. The registration
// signal is dev bookkeeping and must never participate in hydration: it must
// not require an owner (peekNextChildId(null) crashed with "Cannot read
// properties of null (reading '_config')") nor consume hydration child ids.
import { afterEach, describe, expect, test } from "vitest";
import { createRoot, flush, peekNextChildId, getOwner, type Owner } from "@solidjs/signals";
import { createComponent } from "../src/index.js";
import { createMemo, enableHydration, sharedConfig } from "../src/client/hydration.js";
import { $$component, $$registry } from "../src/refresh/index.js";

// Enable the hydration-aware wrappers (as hydrate() does before mounting).
enableHydration();

let hydrationData: Record<string, any> = {};

function startHydration(data: Record<string, any>) {
  hydrationData = data;
  sharedConfig.hydrating = true;
  (sharedConfig as any).has = (id: string) => id in hydrationData;
  (sharedConfig as any).load = (id: string) => hydrationData[id];
  (sharedConfig as any).gather = () => {};
}

function stopHydration() {
  sharedConfig.hydrating = false;
  (sharedConfig as any).has = undefined;
  (sharedConfig as any).load = undefined;
  (sharedConfig as any).gather = undefined;
}

afterEach(() => {
  stopHydration();
});

describe("$$component registration while hydration is active (#2920)", () => {
  test("module-scope registration with no owner does not crash", () => {
    startHydration({});

    // Module evaluation happens outside any reactive owner.
    expect(getOwner()).toBeNull();

    const registry = $$registry();
    let proxy!: (props: {}) => unknown;
    expect(() => {
      proxy = $$component(registry, "Index", function Index() {
        return "lazy content" as any;
      });
    }).not.toThrow();

    // The registration is fully usable once the boundary renders it.
    stopHydration();
    let out: any;
    createRoot(() => {
      out = createComponent(proxy as any, {});
    });
    flush();
    expect(out()).toBe("lazy content");
  });

  test("registration under an id-carrying owner consumes no hydration child ids", () => {
    startHydration({});

    createRoot(
      () => {
        const owner = getOwner() as Owner;
        const before = peekNextChildId(owner);
        // e.g. a NEW component registered during an HMR patch while
        // hydration is still active for part of the tree.
        $$component($$registry(), "Added", function Added() {
          return null as any;
        });
        expect(peekNextChildId(owner)).toBe(before);
      },
      { id: "t" }
    );
    flush();
  });

  test("does not consume a hydration child id", () => {
    startHydration({ t0: "server" });

    // End-to-end: the hydration-aware memo after the registration must still
    // claim id "t0" and restore the serialized server value.
    let result: unknown;
    createRoot(
      () => {
        $$component($$registry(), "Component", () => "component" as any);
        result = createMemo(() => "client")();
      },
      { id: "t" }
    );

    expect(result).toBe("server");
  });

  test("registered component still hot-swaps after hydration ends", () => {
    startHydration({});
    const registry = $$registry();
    const proxy = $$component(registry, "Swap", () => "v1" as any);
    stopHydration();

    let out: any;
    createRoot(() => {
      out = createComponent(proxy as any, {});
    });
    flush();
    expect(out()).toBe("v1");

    registry.components.get("Swap")!.update(() => (() => "v2") as any);
    flush();
    expect(out()).toBe("v2");
  });
});
