/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * Bug hunt: a foreign comment node injected into a dynamic text slot's
 * server HTML (browser extensions, Cloudflare-style CDN rewriters, A/B
 * testing snippets routinely inject comments) permanently breaks that
 * slot's reactivity after hydration — silently, in two different ways:
 *
 * 1. Sole-text slot (`<p>{t()}</p>`): the string fast path in
 *    `insertExpression` writes `parent.firstChild.data = value`
 *    (dom-expressions client.js:779) without checking that firstChild is
 *    the claimed text node. With an injected comment first, every update
 *    is written into the *comment's* data — end state after setT("world"):
 *    `<p><!--world-->hello</p>` — the user forever sees the stale value.
 *
 * 2. Marker-pair slot (`Count: <!--$-->{t()}<!--/-->`): `normalize`
 *    (client.js:824-828) claims text nodes positionally from the nodes
 *    between the markers; the injected comment occupies position 0, so a
 *    fresh detached text node is created instead of claiming the server
 *    text node. The server text node is orphaned (never part of
 *    `current`), so the first update reconciles the fresh node in next to
 *    it: `Count: <!--$--><!--injected-->01<!--/-->` — duplicated content.
 *
 * Server HTML captured from renderToString (see generator snippets inline),
 * then a comment was injected the way third-party rewriters do.
 */
import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { createSignal, flush, enableHydration } from "solid-js";
import { hydrate } from "@solidjs/web";

enableHydration();

function setupHydration() {
  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {} };
}

const tick = (ms = 30) => new Promise(r => setTimeout(r, ms));

describe("hydration: injected comment in a dynamic text slot", () => {
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

  test("sole text child: signal update still reaches the DOM", async () => {
    // Server output (renderToString(() => <div><p>{t()}</p></div>), t = "hello"):
    //   <div _hk=0><p>hello</p></div>
    // ...with a comment injected by a proxy/extension:
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
    // BUG: update is written into the injected comment's data instead:
    // <div _hk="0"><p><!--world-->hello</p></div>
    expect(container.querySelector("p")!.textContent).toBe("world");
  });

  test("marker-pair slot: signal update does not duplicate content", async () => {
    // Server output (renderToString(() => <div><button onClick={...}>Count: {t()}</button></div>), t = 0):
    //   <div _hk=0><button>Count: <!--$-->0<!--/--></button></div>
    // ...with a comment injected between the markers:
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
    // BUG: server text node was never claimed (comment shifted the position),
    // so the fresh client text is inserted NEXT TO it:
    // <button>Count: <!--$--><!--injected-->01<!--/--></button>
    expect(container.querySelector("button")!.textContent).toBe("Count: 1");
  });

  test("control: same slots without injected comments update fine", async () => {
    container.innerHTML = "<div _hk=0><button>Count: <!--$-->0<!--/--></button></div>";
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
    setT(1);
    flush();
    await tick();
    expect(container.querySelector("button")!.textContent).toBe("Count: 1");
  });
});
