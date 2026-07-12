/**
 * @jsxImportSource @solidjs/web
 */
// Hunt 6 (server half): generate SSR artifacts for server/client hydration
// protocol asymmetry checks. The dom half replays these in
// test/hydration/hunt6-asym.spec.tsx (identical component sources compiled
// with the dom generate live in test/harness/hunt6-scenarios.tsx).
import { describe, expect, test } from "vitest";
import { renderToStream, renderToString } from "@solidjs/web";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { scenarios } from "../harness/hunt6-scenarios.jsx";

const artifactsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../harness/__artifacts__");

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

describe("hunt6 asym artifacts", () => {
  for (const s of scenarios) {
    test(s.name, async () => {
      mkdirSync(artifactsDir, { recursive: true });
      let shell: string;
      let rest: string;
      if (s.sync) {
        shell = renderToString(() => <s.App />);
        rest = "";
      } else {
        const chunks = await collectChunks(() => <s.App />);
        shell = chunks[0];
        rest = chunks.slice(1).join("");
      }
      writeFileSync(
        resolve(artifactsDir, `hunt6-${s.name}.json`),
        JSON.stringify({ shell, rest }, null, 2)
      );
      expect(shell.length).toBeGreaterThan(0);
    });
  }
});
