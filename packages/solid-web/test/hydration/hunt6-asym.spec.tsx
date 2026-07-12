/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * Hunt 6 (dom half): replays test/harness/__artifacts__/hunt6-*.json produced
 * by test/server/hunt6-asym-gen.spec.tsx and hydrates the identically-sourced
 * components (test/harness/hunt6-scenarios.tsx), asserting text parity, no
 * hydration warnings, and post-hydration updates.
 */
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { flush, enableHydration } from "solid-js";
import { hydrate } from "@solidjs/web";
import { scenarios, type Hunt6Scenario } from "../harness/hunt6-scenarios.jsx";

enableHydration();

const artifactsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../harness/__artifacts__");
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function loadArtifact(name: string): { shell: string; rest: string } {
  const file = resolve(artifactsDir, `hunt6-${name}.json`);
  if (!existsSync(file)) {
    throw new Error(
      `Missing artifact hunt6-${name}.json — run: ` +
        `npx vitest run --config vite.config.server.mjs test/server/hunt6-asym-gen.spec.tsx`
    );
  }
  return JSON.parse(readFileSync(file, "utf-8"));
}

function applyChunk(container: HTMLDivElement, chunk: string, first: boolean) {
  const scriptRe = /<script(?:[^>]*)>([\s\S]*?)<\/script>/g;
  const scripts = [...chunk.matchAll(scriptRe)].map(m => m[1]);
  const stripped = chunk.replace(scriptRe, "");
  if (first) container.innerHTML = stripped;
  else container.insertAdjacentHTML("beforeend", stripped);
  for (const s of scripts) (0, eval)(s);
}

async function settle() {
  await sleep(40);
  flush();
  await sleep(40);
  flush();
}

async function runScenario(scenario: Hunt6Scenario, mode: "loaded" | "streamed") {
  const { shell, rest } = loadArtifact(scenario.name);
  const container = document.createElement("div");
  document.body.appendChild(container);
  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  let dispose: (() => void) | undefined;
  try {
    applyChunk(container, shell, true);
    if (mode === "loaded" && rest) applyChunk(container, rest, false);

    dispose = hydrate(() => <scenario.App />, container);
    flush();
    await sleep(10);
    flush();

    if (mode === "streamed" && rest) {
      await sleep(30);
      flush();
      applyChunk(container, rest, false);
    }
    await settle();

    expect(container.textContent).toBe(scenario.expectedText);

    if (scenario.update) {
      scenario.update();
      flush();
      await settle();
      expect(container.textContent).toBe(scenario.expectedTextAfterUpdate ?? scenario.expectedText);
    }

    expect(warn).not.toHaveBeenCalled();
  } finally {
    warn.mockRestore();
    dispose?.();
    await sleep(0);
    container.remove();
  }
}

describe("hunt6 asym — client hydrate", () => {
  beforeEach(async () => {
    await sleep(0);
  });
  afterEach(async () => {
    await sleep(0);
  });

  for (const scenario of scenarios) {
    const modes: Array<"loaded" | "streamed"> = scenario.sync ? ["loaded"] : ["loaded", "streamed"];
    for (const mode of modes) {
      test(`${scenario.name} [${mode}]`, () => runScenario(scenario, mode));
    }
  }
});
