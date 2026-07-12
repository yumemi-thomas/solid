/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 * SCRATCH exploration spec 2 — streamed boundaries + assets dispose.
 */
import { describe, expect, test, beforeEach, afterEach, vi } from "vitest";
import { createSignal, createMemo, flush, enableHydration, Loading } from "solid-js";
import { hydrate } from "@solidjs/web";

enableHydration();

function setupHydration() {
  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
  delete (globalThis as any).$R;
}

const tick = (ms = 30) => new Promise(r => setTimeout(r, ms));
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Captured from a real renderToStream run (see test/server/hunt2-gen.spec.tsx):
// two sibling Loading boundaries, second one (id 4, "BBB") resolves before the
// first (id 3, "AAA").
const CHUNKS: string[] = [
  '<div _hk=2><!--$--><template id="pl-3"></template><span _hk=30>la</span><!--pl-3--><!--/--><!--$--><template id="pl-4"></template><span _hk=40>lb</span><!--pl-4--><!--/--><button>go</button></div><script>(self.$R=self.$R||{})[""]=[];_$HY.r["0"]=$R[0]=($R[1]=($R[2]=() => {\n  const resolver = {\n    p: 0,\n    s: 0,\n    f: 0\n  };\n  resolver.p = new Promise((resolve, reject) => {\n    resolver.s = resolve;\n    resolver.f = reject;\n  });\n  return resolver;\n})()).p;_$HY.r["1"]=$R[3]=($R[4]=$R[2]()).p;_$HY.r["3_fr"]=$R[5]=($R[6]=$R[2]()).p;_$HY.r["4_fr"]=$R[7]=($R[8]=$R[2]()).p;</script>',
  '<template id="4"><p _hk=4000>BBB</p></template>',
  '<script>($R[9]=(resolver, data) => {\n  resolver.s(data);\n  resolver.p.s = 1;\n  resolver.p.v = data;\n})($R[4],"BBB");$df("4");function $df(e,n,o,t){if(!(n=document.getElementById(e))||!(o=document.getElementById("pl-"+e)))return 0;for(;o&&8!==o.nodeType&&o.nodeValue!=="pl-"+e;)t=o.nextSibling,o.remove(),o=t;_$HY.done?o.remove():o.replaceWith(n.content),n.remove(),_$HY.fe(e);return 1}function $dfl(e,o,n){if(!(o=document.getElementById("pl-"+e)))return 0;if(o._$fl)return 1;for(n=o.nextSibling;n;){if(8===n.nodeType&&n.nodeValue==="pl-"+e){o.parentNode&&o.parentNode.insertBefore(o.content.cloneNode(!0),n),o._$fl=1;return 1}n=n.nextSibling}return 0}function $dfs(e,c,d){(_$HY.sc=_$HY.sc||{})[e]=c,d&&((_$HY.sd=_$HY.sd||{})[e]=1)}function $dfg(e,g,i,k){if(!(g=_$HY.sg&&_$HY.sg[e]))return;for(i=0;i<g.length;i++)if(_$HY.sc&&_$HY.sc[g[i]]>0)return;for(i=0;i<g.length;i++)k=g[i],delete _$HY.sg[k],$df(k)}function $dfc(e){if(--_$HY.sc[e]<=0){delete _$HY.sc[e],_$HY.sg&&_$HY.sg[e]?$dfg(e):!(_$HY.sd&&_$HY.sd[e])&&$df(e);_$HY.sd&&delete _$HY.sd[e]}}function $dfj(e,i,n){for(i=0;i<e.length;i++)if(_$HY.sc&&_$HY.sc[e[i]]>0){for(n=0;n<e.length;n++)(_$HY.sg=_$HY.sg||{})[e[n]]=e;return}for(i=0;i<e.length;i++)$df(e[i])};$R[9]($R[8],!0);</script>',
  '<template id="3"><p _hk=3000>AAA</p></template>',
  '<script>$R[9]($R[1],"AAA");$df("3");$R[9]($R[6],!0);</script>'
];

function applyChunk(container: HTMLDivElement, chunk: string, first: boolean) {
  const scriptRe = /<script(?:[^>]*)>([\s\S]*?)<\/script>/g;
  const scripts = [...chunk.matchAll(scriptRe)].map(m => m[1]);
  const stripped = chunk.replace(scriptRe, "");
  if (first) container.innerHTML = stripped;
  else container.insertAdjacentHTML("beforeend", stripped);
  for (const s of scripts) (0, eval)(s);
}

describe("hunt2 scratch 2", () => {
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

  const clicks: string[] = [];
  function App() {
    const a = createMemo(async () => {
      await sleep(40);
      return "AAA";
    });
    const b = createMemo(async () => {
      await sleep(10);
      return "BBB";
    });
    return (
      <div>
        <Loading fallback={<span>la</span>}>
          <p onClick={() => clicks.push("a")}>{a()}</p>
        </Loading>
        <Loading fallback={<span>lb</span>}>
          <p onClick={() => clicks.push("b")}>{b()}</p>
        </Loading>
        <button onClick={() => clicks.push("btn")}>go</button>
      </div>
    );
  }

  test("S1: hydrate after shell, fragments arrive out of order", async () => {
    clicks.length = 0;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    applyChunk(container, CHUNKS[0], true);
    dispose = hydrate(() => <App />, container);
    flush();
    await Promise.resolve();
    applyChunk(container, CHUNKS[1], false);
    applyChunk(container, CHUNKS[2], false);
    await Promise.resolve();
    flush();
    applyChunk(container, CHUNKS[3], false);
    applyChunk(container, CHUNKS[4], false);
    await Promise.resolve();
    flush();
    await tick(60);

    expect(container.querySelectorAll("span").length).toBe(0);
    expect(container.querySelectorAll("p").length).toBe(2);
    expect(container.textContent).toBe("AAABBBgo");
    // claimed, not re-created: handlers must be bound to the visible nodes
    const ps = container.querySelectorAll("p");
    ps[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    ps[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    container.querySelector("button")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(clicks).toEqual(["a", "b", "btn"]);
    const orphanWarns = warn.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === "string" && c[0].includes("unclaimed server-rendered node")
    );
    expect(orphanWarns).toHaveLength(0);
    warn.mockRestore();
  });

  test("S2: hydrate after all chunks already applied (slow JS)", async () => {
    clicks.length = 0;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    applyChunk(container, CHUNKS[0], true);
    applyChunk(container, CHUNKS[1], false);
    applyChunk(container, CHUNKS[2], false);
    applyChunk(container, CHUNKS[3], false);
    applyChunk(container, CHUNKS[4], false);
    dispose = hydrate(() => <App />, container);
    flush();
    await tick(60);

    expect(container.querySelectorAll("span").length).toBe(0);
    expect(container.querySelectorAll("p").length).toBe(2);
    expect(container.textContent).toBe("AAABBBgo");
    const ps = container.querySelectorAll("p");
    ps[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    ps[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(clicks).toEqual(["a", "b"]);
    const orphanWarns = warn.mock.calls.filter(
      (c: unknown[]) => typeof c[0] === "string" && c[0].includes("unclaimed server-rendered node")
    );
    expect(orphanWarns).toHaveLength(0);
    warn.mockRestore();
  });

  test("S3: dispose before module assets finish loading cancels the mount", async () => {
    // lazy hydration: root _assets mapping defers the actual mount behind
    // dynamic import()s. Disposing during that window must cancel the mount.
    let resolveModule!: () => void;
    const modP = new Promise<void>(r => (resolveModule = r));
    const entry = `data:text/javascript,await globalThis.__hunt2ModGate; export default 1;`;
    (globalThis as any).__hunt2ModGate = modP;

    container.innerHTML = "<div _hk=0><button>A</button><button>B</button></div>";
    (globalThis as any)._$HY.r["_assets"] = { "mod-a": entry };

    const clicks2: string[] = [];
    const d = hydrate(() => {
      return (
        <div>
          <button onClick={() => clicks2.push("A")}>A</button>
          <button onClick={() => clicks2.push("B")}>B</button>
        </div>
      );
    }, container);
    // dispose before the module finishes loading
    d();
    resolveModule();
    await tick(20);

    // the mount must have been cancelled: no live handlers
    container.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(clicks2).toEqual([]);
  });
});
