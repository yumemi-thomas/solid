import { describe, expect, it } from "vitest";
import { children } from "solid-js";
// Direct source imports while frames are pre-facade: the pnpm override links
// @dom-expressions/runtime to the sibling frame-streams branch, and this
// config's rxcore alias points its internals at solid-web's core — so this
// exercises the projection proxy under Solid's real SSR compile + reactive
// core, which is exactly the integration question.
import { renderServerComponent } from "@dom-expressions/runtime/src/frame-sink.js";
import { createJSONDataTable } from "@dom-expressions/runtime/src/serializer.js";

const collect = (stream: any): Promise<any[]> => stream;

describe("server components authored with Solid JSX", () => {
  it("emits a direct-insert marker for {props.children} through the SSR compile", async () => {
    const ServerComp = (props: any) => (
      <section>
        <h1>Story</h1>
        {props.children}
      </section>
    );
    const chunks = await collect(renderServerComponent(ServerComp, { frame: { id: "f0" } }));
    const html = chunks.find(c => c.type === "html").html;
    expect(html).toContain("<h1>Story</h1>");
    expect(html).toContain("<!--proj:children:start--><!--proj:children:end-->");
    expect(chunks.filter(c => c.type === "slot")).toEqual([]);
  });

  it("treats a prop used in component position as a render-prop slot", async () => {
    // The natural Solid authoring for a client projection with args: SSR
    // compiles component-position props to direct calls, which is exactly
    // the proxy's render-prop shape.
    const ServerComp = (props: any) => (
      <ul>
        {["a", "b"].map((label, i) => (
          <props.comment label={label} meta={{ i }} />
        ))}
      </ul>
    );
    const chunks = await collect(renderServerComponent(ServerComp, { frame: { id: "f1" } }));
    const slots = chunks.filter(c => c.type === "slot");
    expect(slots.map(c => c.key)).toEqual(["comment#0", "comment#1"]);
    expect(slots[0].args.label).toBe("a");
    const table = createJSONDataTable();
    for (const c of chunks.filter(x => x.type === "data")) table.apply(c);
    expect(table.resolve(slots[1].args.meta)).toEqual({ i: 1 });
    const html = chunks.find(c => c.type === "html").html;
    expect(html).toContain("<!--proj:comment#0:start--><!--proj:comment#0:end-->");
    expect(html).toContain("<!--proj:comment#1:start--><!--proj:comment#1:end-->");
  });

  it("survives the children() helper", async () => {
    const ServerComp = (props: any) => {
      const resolved = children(() => props.children);
      return <div>{resolved()}</div>;
    };
    const chunks = await collect(renderServerComponent(ServerComp, { frame: { id: "f2" } }));
    const html = chunks.find(c => c.type === "html").html;
    // The hydratable compile allocates a hydration key around the children()
    // memo — expected; the projection range itself is intact.
    expect(html).toMatch(
      /^<div( _hk=\d+)?><!--proj:children:start--><!--proj:children:end--><\/div>$/
    );
  });
});
