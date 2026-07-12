/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { describe, test } from "vitest";
import { createSignal, flush, enableHydration } from "solid-js";
import { hydrate } from "@solidjs/web";
enableHydration();
const tick = (ms = 30) => new Promise(r => setTimeout(r, ms));
describe("dbg", () => {
  test("debug injected comment paths", async () => {
    (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {} };
    const c1 = document.createElement("div");
    document.body.appendChild(c1);
    c1.innerHTML = "<div _hk=0><p><!--injected-->hello</p></div>";
    let setT!: (v: string) => void;
    const d1 = hydrate(() => {
      const [t, _set] = createSignal("hello");
      setT = _set;
      return (
        <div>
          <p>{t()}</p>
        </div>
      );
    }, c1);
    await tick();
    setT("world");
    flush();
    await tick();
    (await import("fs")).appendFileSync(
      "/private/tmp/claude-501/-Users-thomas-Documents-Github-solid/06794401-a08a-49d1-bcd4-095380410722/scratchpad/dbg.txt",
      "E3a: " + c1.innerHTML + "\n"
    );
    d1();
    c1.remove();

    (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {} };
    const c2 = document.createElement("div");
    document.body.appendChild(c2);
    c2.innerHTML = "<div _hk=0><button>Count: <!--$--><!--injected-->0<!--/--></button></div>";
    let setN!: (v: number) => void;
    const d2 = hydrate(() => {
      const [n, _set] = createSignal(0);
      setN = _set;
      return (
        <div>
          <button onClick={() => {}}>Count: {n()}</button>
        </div>
      );
    }, c2);
    await tick();
    setN(1);
    flush();
    await tick();
    (await import("fs")).appendFileSync(
      "/private/tmp/claude-501/-Users-thomas-Documents-Github-solid/06794401-a08a-49d1-bcd4-095380410722/scratchpad/dbg.txt",
      "E3b: " + c2.innerHTML + "\n"
    );
    d2();
    c2.remove();
  });
});
