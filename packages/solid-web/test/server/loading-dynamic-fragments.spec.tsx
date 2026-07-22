/**
 * @jsxImportSource @solidjs/web
 */
// Two sibling <Loading> boundaries each holding a promise-backed dynamic():
// EVERY boundary's `<id>_fr` fragment record must patch in the streamed
// document, regardless of resolution order. Found via the hackernews
// example: with two dynamics pending concurrently, the FIRST to resolve
// lost its patch — its Loading hung forever client-side and hydration
// emptied the boundary.
import { describe, expect, test } from "vitest";
import { renderToStream, Loading, dynamic } from "@solidjs/web";

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

function collect(code: () => any): Promise<string> {
  return new Promise(resolve => {
    const chunks: string[] = [];
    renderToStream(code).pipe({
      write: (c: string) => chunks.push(c),
      end: () => resolve(chunks.join(""))
    });
  });
}

function fragmentPatches(html: string) {
  const recs = [...html.matchAll(/_\$HY\.r\["([\w]+_fr)"\]=\$R\[(\d+)\]=\(\$R\[(\d+)\]/g)];
  const patches = new Set([...html.matchAll(/\$R\[\d+\]\(\$R\[(\d+)\],/g)].map(m => m[1]));
  return Object.fromEntries(recs.map(([, key, , factory]) => [key, patches.has(factory)]));
}

describe("concurrent promise-backed dynamics under Loading", () => {
  // KNOWN FAILING (2026-07-21): the first-resolving boundary's `_fr` never
  // patches — its record is written, the content splices into the shell,
  // but the resolution patch is lost (suspected: fragment-resolve vs
  // serializer flush ordering on the pre-first-flush path). Remove
  // `.fails` when fixing; the assertion below is the acceptance.
  test.fails("both fragment records patch, whichever resolves first", async () => {
    const A = () => <b>alpha</b>;
    const B = () => <i>beta</i>;
    const Fast = dynamic(() => wait(10).then(() => A));
    const Slow = dynamic(() => wait(60).then(() => B));

    const html = await collect(() => (
      <div>
        <section id="fast">
          <Loading fallback={<span>f…</span>}>
            <Fast />
          </Loading>
        </section>
        <section id="slow">
          <Loading fallback={<span>s…</span>}>
            <Slow />
          </Loading>
        </section>
      </div>
    ));

    expect(html).toContain(">alpha</b>");
    expect(html).toContain(">beta</i>");
    const status = fragmentPatches(html);
    expect(Object.keys(status).length).toBeGreaterThanOrEqual(2);
    expect(status).toEqual(
      Object.fromEntries(Object.keys(status).map(k => [k, true]))
    );
  });
});
