/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 * SCRATCH exploration spec — will be split into per-bug files.
 */
import { describe, expect, test, beforeEach, afterEach, vi } from "vitest";
import { createSignal, flush, enableHydration, For, Show } from "solid-js";
import { hydrate } from "@solidjs/web";

enableHydration();

function setupHydration() {
  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {} };
}

const tick = (ms = 30) => new Promise(r => setTimeout(r, ms));

describe("hunt2 scratch", () => {
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

  test("E1: For reorders correctly after hydration", async () => {
    // server: <div><ul><For .../></ul><button>swap</button></div>
    container.innerHTML =
      "<div _hk=0><ul><li _hk=100>alpha</li><li _hk=110>beta</li><li _hk=120>gamma</li></ul><button>swap</button></div>";
    const a = { id: "a", label: "alpha" },
      b = { id: "b", label: "beta" },
      c = { id: "c", label: "gamma" };
    let setItems!: (v: any[]) => void;
    dispose = hydrate(() => {
      const [items, _set] = createSignal([a, b, c]);
      setItems = _set;
      return (
        <div>
          <ul>
            <For each={items()}>{item => <li onClick={() => {}}>{item.label}</li>}</For>
          </ul>
          <button onClick={() => {}}>swap</button>
        </div>
      );
    }, container);
    await tick();
    const ul = container.querySelector("ul")!;
    const liBefore = [...ul.querySelectorAll("li")];
    expect(ul.textContent).toBe("alphabetagamma");
    expect(liBefore.length).toBe(3);

    setItems([c, b, a]);
    flush();
    await tick();
    const liAfter = [...ul.querySelectorAll("li")];
    expect(liAfter.length).toBe(3);
    expect(ul.textContent).toBe("gammabetaalpha");
    // claimed nodes should have been moved, not recreated
    expect(liAfter[0]).toBe(liBefore[2]);
    expect(liAfter[2]).toBe(liBefore[0]);
  });

  test("E2: Show flipped synchronously right after hydrate", async () => {
    container.innerHTML =
      "<div _hk=0><!--$--><span _hk=30>off</span><!--/--><button>toggle</button></div>";
    let setS!: (v: boolean) => void;
    dispose = hydrate(() => {
      const [s, _set] = createSignal(false);
      setS = _set;
      return (
        <div>
          <Show when={s()} fallback={<span>off</span>}>
            <span>on</span>
          </Show>
          <button onClick={() => setS(true)}>toggle</button>
        </div>
      );
    }, container);
    // flip immediately, no macrotask wait
    setS(true);
    flush();
    expect(container.textContent).toBe("ontoggle");
    await tick();
    expect(container.textContent).toBe("ontoggle");
    expect(container.querySelectorAll("span").length).toBe(1);
  });

  test("E3a: injected comment before sole text child — update still lands", async () => {
    // server: <div _hk=0><p>hello</p></div>, CDN/extension injected a comment
    container.innerHTML = "<div _hk=0><p><!--injected-->hello</p></div>";
    let setT!: (v: string) => void;
    dispose = hydrate(() => {
      const [t, _set] = createSignal("hello");
      setT = _set;
      return (
        <div>
          <p>{t()}</p>
        </div>
      );
    }, container);
    await tick();
    expect(container.querySelector("p")!.textContent).toBe("hello");
    setT("world");
    flush();
    await tick();
    expect(container.querySelector("p")!.textContent).toBe("world");
  });

  test("E3b: injected comment inside marker pair — update still lands, no dupes", async () => {
    container.innerHTML =
      "<div _hk=0><button>Count: <!--$--><!--injected-->0<!--/--></button></div>";
    let setT!: (v: number) => void;
    dispose = hydrate(() => {
      const [t, _set] = createSignal(0);
      setT = _set;
      return (
        <div>
          <button onClick={() => {}}>Count: {t()}</button>
        </div>
      );
    }, container);
    await tick();
    expect(container.querySelector("button")!.textContent).toBe("Count: 0");
    setT(1);
    flush();
    await tick();
    expect(container.querySelector("button")!.textContent).toBe("Count: 1");
  });

  test("E4: form elements reflect signal state after hydration", async () => {
    container.innerHTML =
      '<div _hk=0><textarea>world</textarea><select value="b"><option value="a">A</option><option value="b">B</option></select><input type="checkbox" checked><input type="text" value="world"></div>';
    let setSel!: (v: string) => void;
    let setV!: (v: string) => void;
    dispose = hydrate(() => {
      const [v, _setV] = createSignal("world");
      const [sel, _setSel] = createSignal("b");
      const [chk] = createSignal(true);
      setSel = _setSel;
      setV = _setV;
      return (
        <div>
          <textarea value={v()} onInput={() => {}} />
          <select value={sel()} onChange={() => {}}>
            <option value="a">A</option>
            <option value="b">B</option>
          </select>
          <input type="checkbox" checked={chk()} onChange={() => {}} />
          <input type="text" value={v()} onInput={() => {}} />
        </div>
      );
    }, container);
    await tick();
    const textarea = container.querySelector("textarea")!;
    const select = container.querySelector("select")!;
    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    const input = container.querySelector('input[type="text"]') as HTMLInputElement;
    expect(textarea.value).toBe("world");
    expect(checkbox.checked).toBe(true);
    expect(input.value).toBe("world");
    expect(select.value).toBe("b"); // suspect: attribute doesn't select in real DOM

    // post-hydration reactivity
    setSel("a");
    setV("next");
    flush();
    await tick();
    expect(select.value).toBe("a");
    expect(input.value).toBe("next");
    expect(textarea.value).toBe("next");
  });

  test("E5: stale pre-hydration event on removed node does not block replay", async () => {
    container.innerHTML = "<div _hk=0><button>A</button><button>B</button></div>";
    // Simulate the hydration bootstrap capture (generateHydrationScript):
    // user clicked a Loading-fallback button that streaming already removed,
    // then clicked button B which is still in the DOM.
    const removedFallbackBtn = document.createElement("button");
    removedFallbackBtn.setAttribute("_hk", "999");
    const staleEvent = new MouseEvent("click", { bubbles: true });
    const bBtnEvent = new MouseEvent("click", { bubbles: true });
    const bBtn = container.querySelectorAll("button")[1];
    (globalThis as any)._$HY.events.push([removedFallbackBtn, staleEvent]);
    (globalThis as any)._$HY.events.push([bBtn, bBtnEvent]);

    const clicks: string[] = [];
    dispose = hydrate(() => {
      return (
        <div>
          <button onClick={() => clicks.push("A")}>A</button>
          <button onClick={() => clicks.push("B")}>B</button>
        </div>
      );
    }, container);
    await tick();
    // replayed pre-hydration click on B must fire
    expect(clicks).toEqual(["B"]);
    // and live clicks after hydration still work
    container
      .querySelectorAll("button")[0]
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(clicks).toEqual(["B", "A"]);
  });

  test("E6: disposing hydrate leaves server DOM in place (per hydrate() docs)", async () => {
    container.innerHTML = "<div _hk=0><button>A</button><button>B</button></div>";
    dispose = hydrate(() => {
      return (
        <div>
          <button onClick={() => {}}>A</button>
          <button onClick={() => {}}>B</button>
        </div>
      );
    }, container);
    await tick();
    expect(container.textContent).toBe("AB");
    dispose();
    dispose = undefined;
    // "Returns a `dispose` function that tears down reactive scopes
    //  (DOM nodes are left in place)."
    expect(container.textContent).toBe("AB");
  });
});
