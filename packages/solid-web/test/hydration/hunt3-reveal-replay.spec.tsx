/**
 * @vitest-environment jsdom
 *
 * Replays hunt3 reveal chunk artifacts (written by
 * test/server/hunt3-reveal-gen.spec.tsx) into jsdom the way a streaming
 * browser would — markup applied, inline scripts evaluated in arrival order —
 * and asserts the final DOM. No hydration involved: this validates the
 * streamed activation scripts ($df/$dfj) alone.
 *
 * Context: with the fix severing RevealGroupContext inside Loading boundaries
 * (issue draft 01), a nested boundary activates independently. If it resolves
 * BEFORE its ancestor Reveal group releases, its $df fires while its
 * placeholder is still inside a flushed-but-unactivated <template> —
 * document.getElementById can't see template content, $df returns 0, and the
 * swap is silently dropped (fallback stuck, content lost).
 *
 * The dom-expressions REPLACE_SCRIPT needs a deferred queue: a $df miss
 * queues the key; every successful swap drains the queue (it may have made
 * queued placeholders live). PATCHED_DF below is that proposed runtime; the
 * third test validates it against the same stream.
 */
import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const artifactsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../harness/__artifacts__");

// Exact $df from @dom-expressions/runtime REPLACE_SCRIPT (0.50.0-next.17).
const ORIGINAL_DF =
  'function $df(e,n,o,t){if(!(n=document.getElementById(e))||!(o=document.getElementById("pl-"+e)))return 0;for(;o&&8!==o.nodeType&&o.nodeValue!=="pl-"+e;)t=o.nextSibling,o.remove(),o=t;_$HY.done?o.remove():o.replaceWith(n.content),n.remove(),_$HY.fe(e);return 1}';

// Exact fix from dom-expressions branch fix/df-deferred-swap-queue:
// template-present/marker-missing misses queue on _$HY.dq/_$HY.dlq; $dfd()
// drains both after every successful swap or fallback materialization.
// Template missing entirely = already swapped: no-op, never queued.
const PATCHED_DF =
  'function $df(e,n,o,t){if(!(n=document.getElementById(e)))return 0;if(!(o=document.getElementById("pl-"+e)))return (_$HY.dq=_$HY.dq||[]).indexOf(e)<0&&_$HY.dq.push(e),0;for(;o&&8!==o.nodeType&&o.nodeValue!=="pl-"+e;)t=o.nextSibling,o.remove(),o=t;_$HY.done?o.remove():o.replaceWith(n.content),n.remove(),_$HY.fe(e);$dfd();return 1}';

const ORIGINAL_DFL =
  'function $dfl(e,o,n){if(!(o=document.getElementById("pl-"+e)))return 0;if(o._$fl)return 1;for(n=o.nextSibling;n;){if(8===n.nodeType&&n.nodeValue==="pl-"+e){o.parentNode&&o.parentNode.insertBefore(o.content.cloneNode(!0),n),o._$fl=1;return 1}n=n.nextSibling}return 0}';

const PATCHED_DFL =
  'function $dfl(e,o,n){if(!(o=document.getElementById("pl-"+e)))return (_$HY.dlq=_$HY.dlq||[]).indexOf(e)<0&&_$HY.dlq.push(e),0;if(o._$fl)return 1;for(n=o.nextSibling;n;){if(8===n.nodeType&&n.nodeValue==="pl-"+e){o.parentNode&&o.parentNode.insertBefore(o.content.cloneNode(!0),n),o._$fl=1;$dfd();return 1}n=n.nextSibling}return 0}function $dfd(t,o){if(t=_$HY.dq){_$HY.dq=null;for(o=0;o<t.length;o++)$df(t[o])}if(t=_$HY.dlq){_$HY.dlq=null;for(o=0;o<t.length;o++)$dfl(t[o])}}';

function loadChunks(name: string): string[] {
  const file = resolve(artifactsDir, `hunt3-${name}.json`);
  if (!existsSync(file)) {
    throw new Error(
      `Missing artifact hunt3-${name}.json. Run: ` +
        `vitest run --config vite.config.server.mjs test/server/hunt3-reveal-gen.spec.tsx`
    );
  }
  return JSON.parse(readFileSync(file, "utf-8")).chunks;
}

function replay(chunks: string[], transformScript: (s: string) => string = s => s): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const scriptRe = /<script(?:[^>]*)>([\s\S]*?)<\/script>/g;
  chunks.forEach((chunk, i) => {
    const scripts = [...chunk.matchAll(scriptRe)].map(m => transformScript(m[1]));
    const stripped = chunk.replace(scriptRe, "");
    if (i === 0) container.innerHTML = stripped;
    else container.insertAdjacentHTML("beforeend", stripped);
    for (const s of scripts) (0, eval)(s);
  });
  return container;
}

const withPatchedRuntime = (s: string) =>
  s.split(ORIGINAL_DF).join(PATCHED_DF).split(ORIGINAL_DFL).join(PATCHED_DFL);

describe("streamed reveal activation replay", () => {
  beforeEach(() => {
    (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("nested boundary resolving AFTER group release swaps in", () => {
    const container = replay(loadChunks("together-nested-sibling"));
    expect(container.textContent).toContain("A-fast");
    expect(container.textContent).toContain("B-mid");
    expect(container.textContent).toContain("A-nested");
    expect(container.textContent).not.toContain("na");
  });

  // KNOWN LIMITATION of the RevealGroupContext severing fix: flip to a plain
  // test once the dom-expressions $df deferred-queue fix (PATCHED_DF) ships.
  test.fails(
    "nested boundary resolving BEFORE group release still swaps in (stock runtime)",
    () => {
      const container = replay(loadChunks("nested-early"));
      expect(container.textContent).toContain("A-nested");
      expect(container.textContent).not.toContain("na");
    }
  );

  test("nested boundary resolving BEFORE group release swaps in with queued $df runtime", () => {
    const container = replay(loadChunks("nested-early"), withPatchedRuntime);
    expect(container.textContent).toContain("A-fast");
    expect(container.textContent).toContain("B-slow");
    expect(container.textContent).toContain("A-nested");
    expect(container.textContent).not.toContain("na");
  });

  test("plain nested Loading (no Reveal), inner resolves first — safe via buffered replace", () => {
    const container = replay(loadChunks("plain-nested-early"));
    expect(container.textContent).toContain("outer-late");
    expect(container.textContent).toContain("inner-early");
    expect(container.textContent).not.toContain("ni");
    expect(container.textContent).not.toContain("fo");
  });
});
