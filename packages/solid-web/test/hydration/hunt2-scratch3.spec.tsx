/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 * SCRATCH exploration spec 3 — refs, For fallback, NoHydration siblings.
 */
import { describe, expect, test, beforeEach, afterEach, vi } from "vitest";
import { createSignal, flush, enableHydration, For, NoHydration } from "solid-js";
import { hydrate } from "@solidjs/web";

enableHydration();

function setupHydration() {
  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {} };
}

const tick = (ms = 30) => new Promise(r => setTimeout(r, ms));

describe("hunt2 scratch 3", () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let dispose: (() => void) | undefined;

  beforeEach(async () => {
    if (dispose) dispose();
    await tick(0);
    setupHydration();
    container.innerHTML = "";
  });

  afterEach(() => {
    if (dispose) {
      dispose();
      dispose = undefined;
    }
  });

  test("R1: ref receives the claimed server node during hydration", async () => {
    container.innerHTML = "<div _hk=0><p>hello</p></div>";
    const serverP = container.querySelector("p");
    let refEl: any;
    dispose = hydrate(() => {
      return (
        <div>
          <p ref={el => (refEl = el)}>hello</p>
        </div>
      );
    }, container);
    await tick();
    expect(refEl).toBe(serverP);
    expect(refEl?.isConnected).toBe(true);
  });

  test("R2: For fallback replaced when items arrive after hydration", async () => {
    container.innerHTML = "<div _hk=0><ul><li _hk=100>empty</li></ul><button>add</button></div>";
    let setItems!: (v: string[]) => void;
    dispose = hydrate(() => {
      const [items, _set] = createSignal<string[]>([]);
      setItems = _set;
      return (
        <div>
          <ul>
            <For each={items()} fallback={<li>empty</li>}>
              {item => <li>{item}</li>}
            </For>
          </ul>
          <button onClick={() => {}}>add</button>
        </div>
      );
    }, container);
    await tick();
    expect(container.querySelector("ul")!.textContent).toBe("empty");

    setItems(["one", "two"]);
    flush();
    await tick();
    expect(container.querySelector("ul")!.textContent).toBe("onetwo");
    expect(container.querySelectorAll("li").length).toBe(2);

    setItems([]);
    flush();
    await tick();
    expect(container.querySelector("ul")!.textContent).toBe("empty");
    expect(container.querySelectorAll("li").length).toBe(1);
  });

  test("R3: NoHydration static content survives sibling updates", async () => {
    container.innerHTML =
      "<div _hk=0><!--$--><span>static</span><!--/--><button>b:<!--$-->0<!--/--></button></div>";
    let setT!: (v: number) => void;
    dispose = hydrate(() => {
      const [t, _set] = createSignal(0);
      setT = _set;
      return (
        <div>
          <NoHydration>
            <span>static</span>
          </NoHydration>
          <button onClick={() => setT(v => v + 1)}>b:{t()}</button>
        </div>
      );
    }, container);
    await tick();
    expect(container.textContent).toBe("staticb:0");

    setT(1);
    flush();
    await tick();
    expect(container.textContent).toBe("staticb:1");
    expect(container.querySelector("span")?.textContent).toBe("static");
  });
});
