/**
 * @jsxImportSource @solidjs/web
 *
 * Server half of the hydration parity harness (#2801).
 *
 * Renders every scenario from test/harness/scenarios.tsx with the ssr
 * generate and writes the chunk artifacts that
 * test/hydration/parity-harness.spec.tsx replays into jsdom with the
 * dom-generate compilation of the same source.
 *
 * `pnpm test` runs this project before the hydrate project, so artifacts are
 * always regenerated from current compiler + runtime before being consumed.
 * Artifacts are committed so id/markup changes show up in diffs.
 */
import { describe, expect, test } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStream } from "@solidjs/web";
import { scenarios } from "../harness/scenarios.jsx";

const artifactsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../harness/__artifacts__");
mkdirSync(artifactsDir, { recursive: true });

function collectChunks(code: () => any): Promise<{ shell: string; rest: string }> {
  return new Promise(resolvePromise => {
    const chunks: string[] = [];
    let shell = "";
    let shellDone = false;
    renderToStream(code, {
      onCompleteShell() {
        shellDone = true;
      }
    }).pipe({
      write(chunk: string) {
        chunks.push(chunk);
        if (shellDone && !shell) shell = chunks.join("");
      },
      end() {
        const full = chunks.join("");
        if (!shell) shell = full;
        resolvePromise({ shell, rest: full.slice(shell.length) });
      }
    });
  });
}

describe("hydration parity harness — server render", () => {
  for (const scenario of scenarios) {
    test(scenario.name, async () => {
      const { shell, rest } = await collectChunks(() => <scenario.App />);
      const full = shell + rest;

      // Text sanity: strip scripts, then tags. Template contents survive the
      // tag strip, so late-streamed fragment text is included. serverText
      // overrides expectedText for scenarios with client-only content.
      const visible = full.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]*>/g, "");
      for (const token of (scenario.serverText ?? scenario.expectedText)
        .split(/\s+/)
        .filter(Boolean)) {
        expect(visible).toContain(token);
      }

      writeFileSync(
        resolve(artifactsDir, `${scenario.name}.json`),
        JSON.stringify({ name: scenario.name, shell, rest }, null, 2)
      );
    });
  }
});
