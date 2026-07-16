/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// createServerComponent: a server component used like any Solid component.
// The server side is mocked as hand-framed Responses (the wire contract the
// producer tests pin); this exercises the client half — mount via the insert
// brand, props as projections, reactive re-fetch into the same frame
// (policy A), owner-tied disposal.
import { describe, expect, test } from "vitest";
import { createRoot, createSignal, flush } from "solid-js";
import {
  createServerComponent,
  createFrameHost,
  createJSONDataTable
} from "../frames/src/client.js";
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

function storyResponse(version: number, title: string) {
  return frameResponse("srv", [
    { type: "start", id: "srv", version },
    { type: "slot", id: "srv", version, key: "comment#0", args: { text: "first!" } },
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

describe("createServerComponent", () => {
  test("mounts, fills projections from props, morphs on re-fetch, disposes with the owner", async () => {
    const [story, setStory] = createSignal(1);
    const calls: number[] = [];
    const Story = createServerComponent(
      () => {
        calls.push(story());
        return storyResponse(story(), `Story ${story()}`);
      },
      { id: "story-pane", host: makeHost() }
    );

    const container = document.createElement("div");
    document.body.appendChild(container);
    let div!: HTMLDivElement;
    const dispose = createRoot(d => {
      <div ref={div}>
        <Story comment={(p: any) => <li>{p.text}</li>}>
          <button>toggle</button>
        </Story>
      </div>;
      container.appendChild(div);
      return d;
    });
    flush();
    await settle();

    // Server content + both projections in place.
    expect(div.querySelector("h1")!.textContent).toBe("Story 1");
    expect(div.querySelector("ul li")!.textContent).toBe("first!");
    const button = div.querySelector("footer button")!;
    expect(button.textContent).toBe("toggle");
    expect(calls).toEqual([1]);

    // Client-only state, then navigation: tracked source re-fetches into the
    // same frame — server content morphs, client node identity survives.
    (button as HTMLElement).dataset.on = "yes";
    const h1 = div.querySelector("h1");
    setStory(2);
    flush();
    await settle();
    expect(calls).toEqual([1, 2]);
    expect(div.querySelector("h1")).toBe(h1);
    expect(h1!.textContent).toBe("Story 2");
    expect(div.querySelector("footer button")).toBe(button);
    expect((button as HTMLElement).dataset.on).toBe("yes");

    // Owner disposal tears the boundary down.
    dispose();
    flush();
    expect(div.querySelector("article")).toBe(null);
    container.remove();
  });

  test("props the server never placed stay unmounted; unknown occurrences without props stay empty", async () => {
    const Story = createServerComponent(() => storyResponse(1, "Solo"), {
      id: "solo",
      host: makeHost()
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    let div!: HTMLDivElement;
    const dispose = createRoot(d => {
      // No `comment` prop: the server's comment#0 range stays empty. The
      // extra `sidebar` prop has no server position: never invoked.
      <div ref={div}>
        <Story sidebar={() => <aside>never</aside>}>
          <button>b</button>
        </Story>
      </div>;
      container.appendChild(div);
      return d;
    });
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
