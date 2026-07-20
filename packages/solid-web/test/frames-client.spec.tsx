/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// The zero-API client surface: `dynamic` + a server function IS the server
// component. Importing @solidjs/web/frames installs the transport policy —
// a frame-stream response resolves the call with a stable per-call-site
// component (owner-derived boundary identity), so dynamic's equals-gate
// never remounts across refetches; the response streams into the boundary
// underneath. The server side is mocked as hand-framed Responses behind a
// stubbed fetch, so the REAL server-function stub → transport → component
// pipeline is what's under test.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createRoot, createSignal, flush, Loading } from "solid-js";
import { dynamic } from "../src/index.js";
import { installServerComponents, createFrameHost, createJSONDataTable } from "../frames/src/client.js";
import { createServerReference } from "@dom-expressions/runtime/src/server-functions/client.js";
import { createChunk } from "@dom-expressions/runtime/src/server-functions/shared.js";

function frameResponse(id: string, chunks: any[]) {
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(createChunk(JSON.stringify(chunk)));
      controller.close();
    }
  });
  return new Response(body, { headers: { "X-Frame-Stream": id } });
}

function storyResponse(version: number, title: string, comment = "first!") {
  return frameResponse("srv", [
    { type: "start", id: "srv", version },
    { type: "slot", id: "srv", version, key: "comment#0", args: { text: comment } },
    {
      type: "html",
      id: "srv",
      version,
      html:
        `<article><h1>${title}</h1>` +
        "<ul><!--proj:comment#0:start--><!--proj:comment#0:end--></ul>" +
        "<footer><!--proj:children:start--><!--proj:children:end--></footer>" +
        "</article>"
    },
    { type: "complete", id: "srv", version }
  ]);
}

const settle = () => new Promise(r => setTimeout(r));

function makeHost() {
  const table = createJSONDataTable();
  return createFrameHost({
    applyData: (c: any) => table.apply(c),
    resolve: (ref: any) => table.resolve(ref)
  });
}

// One server function reference for the suite; each test isolates state by
// re-installing the policy against a fresh host and re-stubbing fetch.
const getStory = createServerReference("story/get");

describe("server components through dynamic", () => {
  beforeEach(() => installServerComponents(makeHost()));
  afterEach(() => vi.unstubAllGlobals());

  test("mounts, fills projections from props, morphs on re-fetch without remounting", async () => {
    const [story, setStory] = createSignal(1);
    const fetched: number[] = [];
    // Like a real server, derive the response from the REQUEST body (the
    // codec-encoded args) — signals read inside a foreign async continuation
    // see 2.0's consistent snapshot, not the freshly written value.
    vi.stubGlobal("fetch", async (_base: any, init: any) => {
      const v = Number(/"s":(\d+)/.exec(String(init.body))![1]);
      fetched.push(v);
      return storyResponse(v, `Story ${v}`);
    });

    let mounts = 0;
    const Story = dynamic(() => getStory(story()) as any);

    const container = document.createElement("div");
    document.body.appendChild(container);
    let div!: HTMLDivElement;
    const dispose = createRoot(d => {
      <div ref={div}>
        <Loading fallback={<span>...</span>}>
          <Story
            comment={(p: any) => {
              mounts++;
              return <li>{p.text}</li>;
            }}
          >
            <button>toggle</button>
          </Story>
        </Loading>
      </div>;
      container.appendChild(div);
      return d;
    });
    flush();
    await settle();
    flush();
    await settle();

    // Server content + both projections in place.
    expect(div.querySelector("h1")!.textContent).toBe("Story 1");
    expect(div.querySelector("ul li")!.textContent).toBe("first!");
    const button = div.querySelector("footer button")!;
    expect(button.textContent).toBe("toggle");
    expect(fetched).toEqual([1]);
    expect(mounts).toBe(1);

    // Client-only state, then navigation: the refetch resolves to the SAME
    // component reference — nothing remounts — while the new stream morphs
    // server content in the same boundary. Client node identity survives.
    (button as HTMLElement).dataset.on = "yes";
    const h1 = div.querySelector("h1");
    setStory(2);
    flush();
    await settle();
    flush();
    await settle();
    expect(fetched).toEqual([1, 2]);
    expect(div.querySelector("h1")).toBe(h1);
    expect(h1!.textContent).toBe("Story 2");
    expect(div.querySelector("footer button")).toBe(button);
    expect((button as HTMLElement).dataset.on).toBe("yes");
    // Equivalent re-sent slot args: the occurrence was not re-called.
    expect(mounts).toBe(1);

    // Owner disposal tears the boundary down.
    dispose();
    flush();
    expect(div.querySelector("article")).toBe(null);
    container.remove();
  });

  test("two dynamic() sources over one server function get independent boundaries", async () => {
    const queue = [storyResponse(1, "Left"), storyResponse(1, "Right")];
    vi.stubGlobal("fetch", async () => queue.shift()!);

    const Left = dynamic(() => getStory(1) as any);
    const Right = dynamic(() => getStory(2) as any);

    const container = document.createElement("div");
    document.body.appendChild(container);
    let div!: HTMLDivElement;
    const dispose = createRoot(d => {
      <div ref={div}>
        <Loading fallback={<span>...</span>}>
          <section id="l">
            <Left comment={(p: any) => <li>{p.text}</li>} />
          </section>
          <section id="r">
            <Right comment={(p: any) => <li>{p.text}</li>} />
          </section>
        </Loading>
      </div>;
      container.appendChild(div);
      return d;
    });
    flush();
    await settle();
    flush();
    await settle();

    // Same function, two call sites: two boundaries, nothing declared.
    expect(div.querySelector("#l h1")!.textContent).toBe("Left");
    expect(div.querySelector("#r h1")!.textContent).toBe("Right");

    dispose();
    container.remove();
  });

  test("one server component mounted twice fans the stream out to both instances", async () => {
    const [v, setV] = createSignal(1);
    vi.stubGlobal("fetch", async (_base: any, init: any) => {
      const n = Number(/"s":(\d+)/.exec(String(init.body))![1]);
      return storyResponse(n, `Story ${n}`);
    });

    const Story = dynamic(() => getStory(v()) as any);

    const container = document.createElement("div");
    document.body.appendChild(container);
    let div!: HTMLDivElement;
    const dispose = createRoot(d => {
      <div ref={div}>
        <Loading fallback={<span>...</span>}>
          <section id="a">
            <Story comment={(p: any) => <li>a:{p.text}</li>} />
          </section>
          <section id="b">
            <Story comment={(p: any) => <li>b:{p.text}</li>} />
          </section>
        </Loading>
      </div>;
      container.appendChild(div);
      return d;
    });
    flush();
    await settle();
    flush();
    await settle();

    // One logical stream, two boundary instances, each with its own slots.
    expect(div.querySelector("#a h1")!.textContent).toBe("Story 1");
    expect(div.querySelector("#b h1")!.textContent).toBe("Story 1");
    expect(div.querySelector("#a li")!.textContent).toBe("a:first!");
    expect(div.querySelector("#b li")!.textContent).toBe("b:first!");

    // A refetch morphs both instances.
    setV(2);
    flush();
    await settle();
    flush();
    await settle();
    expect(div.querySelector("#a h1")!.textContent).toBe("Story 2");
    expect(div.querySelector("#b h1")!.textContent).toBe("Story 2");

    dispose();
    container.remove();
  });

  test("ownerless calls fall back to one stable component per function id", async () => {
    vi.stubGlobal("fetch", async () => storyResponse(1, "Solo"));
    const first = await (getStory(1) as any);
    const second = await (getStory(2) as any);
    expect(typeof first).toBe("function");
    expect(second).toBe(first);
  });

  test("props the server never placed stay unmounted; unknown occurrences without props stay empty", async () => {
    vi.stubGlobal("fetch", async () => storyResponse(1, "Solo"));
    const Story = dynamic(() => getStory(1) as any);
    const container = document.createElement("div");
    document.body.appendChild(container);
    let div!: HTMLDivElement;
    const dispose = createRoot(d => {
      // No `comment` prop: the server's comment#0 range stays empty. The
      // extra `sidebar` prop has no server position: never invoked.
      <div ref={div}>
        <Loading fallback={<span>...</span>}>
          <Story sidebar={() => <aside>never</aside>}>
            <button>b</button>
          </Story>
        </Loading>
      </div>;
      container.appendChild(div);
      return d;
    });
    flush();
    await settle();
    flush();
    await settle();
    expect(div.querySelector("h1")!.textContent).toBe("Solo");
    expect(div.querySelector("ul")!.textContent).toBe("");
    expect(div.querySelector("aside")).toBe(null);
    expect(div.querySelector("footer button")!.textContent).toBe("b");
    dispose();
    container.remove();
  });
});
