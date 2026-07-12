/**
 * @jsxImportSource @solidjs/web
 */
import { describe, expect, test } from "vitest";
import { renderToStream } from "@solidjs/web";
import { createMemo, Loading, Errored } from "solid-js";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const artifactsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../harness/__artifacts__");
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function collectChunks(code: () => any, options: any = {}): Promise<string[]> {
  return new Promise(resolvep => {
    const chunks: string[] = [];
    renderToStream(code, options).pipe({
      write(chunk: string) {
        chunks.push(chunk);
      },
      end() {
        resolvep(chunks);
      }
    });
  });
}

describe("hunt6 rejected fragment artifact", () => {
  test("rejected async memo inside streamed Loading", async () => {
    function App() {
      const data = createMemo(async () => {
        await sleep(15);
        throw new Error("nope");
      });
      return (
        <div>
          <Errored fallback={err => <i>E:{(err() as Error).message}</i>}>
            <Loading fallback={<b>w</b>}>
              <p>{data()}</p>
            </Loading>
          </Errored>
        </div>
      );
    }
    const chunks = await collectChunks(() => <App />);
    mkdirSync(artifactsDir, { recursive: true });
    writeFileSync(
      resolve(artifactsDir, "hunt6-rejected-fragment.json"),
      JSON.stringify({ shell: chunks[0], rest: chunks.slice(1).join("") }, null, 2)
    );
    expect(chunks.join("")).toContain("_fr");
  });
});
