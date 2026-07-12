/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 * SCRATCH exploration spec 4 — multi-island late hydrate, Dynamic string tag.
 */
import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { createSignal, flush, enableHydration } from "solid-js";
import { hydrate, Dynamic } from "@solidjs/web";

enableHydration();

function setupHydration() {
  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {} };
}

const tick = (ms = 30) => new Promise(r => setTimeout(r, ms));

describe("hunt2 scratch 4", () => {
  let disposers: (() => void)[] = [];

  afterEach(async () => {
    for (const d of disposers) d();
    disposers = [];
    await tick(0);
  });

  test("M1: second island hydrated later still claims its server DOM", async () => {
    setupHydration();
    const islandA = document.createElement("div");
    const islandB = document.createElement("div");
    document.body.appendChild(islandA);
    document.body.appendChild(islandB);
    islandA.innerHTML = "<div _hk=ia0><button>a:<!--$-->0<!--/--></button></div>";
    islandB.innerHTML = "<div _hk=ib0><button>b:<!--$-->0<!--/--></button></div>";
    const serverBtnB = islandB.querySelector("button")!;

    const IslandA = () => {
      const [t, setT] = createSignal(0);
      return (
        <div>
          <button onClick={() => setT(v => v + 1)}>a:{t()}</button>
        </div>
      );
    };
    const IslandB = () => {
      const [t, setT] = createSignal(0);
      return (
        <div>
          <button onClick={() => setT(v => v + 1)}>b:{t()}</button>
        </div>
      );
    };

    disposers.push(hydrate(IslandA, islandA, { renderId: "ia" } as any));
    // second island hydrates later (e.g. on visibility / after its chunk loads)
    await tick(30);
    disposers.push(hydrate(IslandB, islandB, { renderId: "ib" } as any));
    flush();
    await tick(30);

    // island B must have been *hydrated* — its server DOM claimed, not rebuilt
    expect(islandB.querySelector("button")).toBe(serverBtnB);
    expect(islandB.textContent).toBe("b:0");
    // and interactive
    islandB.querySelector("button")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    flush();
    expect(islandB.textContent).toBe("b:1");

    islandA.remove();
    islandB.remove();
  });

  test("M2: Dynamic string tag claims server element and swaps after hydration", async () => {
    setupHydration();
    const container = document.createElement("div");
    document.body.appendChild(container);
    container.innerHTML = "<div _hk=0><!--$--><em _hk=20 >dyn</em><!--/--><button>x</button></div>";
    const serverEm = container.querySelector("em")!;
    let setTag!: (v: string) => void;
    disposers.push(
      hydrate(() => {
        const [tag, _set] = createSignal("em");
        setTag = _set;
        return (
          <div>
            <Dynamic component={tag() as any} onClick={() => {}}>
              dyn
            </Dynamic>
            <button onClick={() => {}}>x</button>
          </div>
        );
      }, container)
    );
    await tick();
    expect(container.querySelector("em")).toBe(serverEm);
    expect(container.textContent).toBe("dynx");

    setTag("strong");
    flush();
    await tick();
    expect(container.querySelector("em")).toBe(null);
    expect(container.querySelector("strong")?.textContent).toBe("dyn");
    expect(container.textContent).toBe("dynx");
    container.remove();
  });
});
