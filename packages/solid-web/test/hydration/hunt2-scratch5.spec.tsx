/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 * SCRATCH 5 — minimal renderId hydrate probe.
 */
import { describe, expect, test } from "vitest";
import { createSignal, flush, enableHydration } from "solid-js";
import { hydrate } from "@solidjs/web";

enableHydration();

const tick = (ms = 30) => new Promise(r => setTimeout(r, ms));

describe("hunt2 scratch 5", () => {
  test("single island with renderId hydrates", async () => {
    (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {} };
    const islandA = document.createElement("div");
    document.body.appendChild(islandA);
    // server: renderToString(..., { renderId: "ia" })
    islandA.innerHTML = "<div _hk=ia0><button>a:<!--$-->0<!--/--></button></div>";

    const registrySpy: any[] = [];
    const d = hydrate(
      () => {
        const [t, setT] = createSignal(0);
        return (
          <div>
            <button onClick={() => setT(v => v + 1)}>a:{t()}</button>
          </div>
        );
      },
      islandA,
      { renderId: "ia" } as any
    );
    flush();
    await tick();
    expect(islandA.textContent).toBe("a:0");
    d();
    islandA.remove();
  });

  test("control: single island without renderId hydrates", async () => {
    (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {} };
    const islandA = document.createElement("div");
    document.body.appendChild(islandA);
    islandA.innerHTML = "<div _hk=0><button>a:<!--$-->0<!--/--></button></div>";

    const d = hydrate(() => {
      const [t, setT] = createSignal(0);
      return (
        <div>
          <button onClick={() => setT(v => v + 1)}>a:{t()}</button>
        </div>
      );
    }, islandA);
    flush();
    await tick();
    expect(islandA.textContent).toBe("a:0");
    d();
    islandA.remove();
  });
});
