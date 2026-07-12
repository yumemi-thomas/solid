/**
 * @jsxImportSource @solidjs/web
 * TEMPORARY generator — captures renderToStream chunks for Reveal hydration hunt.
 * Run: pnpm vitest run --config vite.config.server.mjs test/server/hunt3-reveal-gen.spec.tsx
 */
import { describe, test } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStream, Loading, Reveal } from "@solidjs/web";
import { createMemo } from "solid-js";

const outDir = resolve(dirname(fileURLToPath(import.meta.url)), "../harness/__artifacts__");

function asyncValue<T>(value: T, ms: number): Promise<T> {
  return new Promise(r => setTimeout(() => r(value), ms));
}

function collectChunks(code: () => any): Promise<string[]> {
  return new Promise(resolve => {
    const chunks: string[] = [];
    renderToStream(code).pipe({
      write(chunk: string) {
        chunks.push(chunk);
      },
      end() {
        resolve(chunks);
      }
    });
  });
}

function dump(name: string, chunks: string[]) {
  mkdirSync(outDir, { recursive: true });
  const path = resolve(outDir, `hunt3-${name}.json`);
  writeFileSync(path, JSON.stringify({ chunks, full: chunks.join("") }, null, 2));
  console.log(`\n=== ${name} (${chunks.length} chunks) ===`);
  chunks.forEach((c, i) => {
    const preview = c.replace(/\s+/g, " ").slice(0, 220);
    console.log(`#${i}: ${preview}`);
  });
  console.log(`wrote ${path}`);
}

describe("hunt3 reveal chunk generator", () => {
  test("together: two siblings, B resolves before A", async () => {
    const chunks = await collectChunks(() => {
      const a = createMemo(async () => asyncValue("AAA", 40));
      const b = createMemo(async () => asyncValue("BBB", 10));
      return (
        <div>
          <Reveal order="together">
            <Loading fallback={<span>la</span>}>
              <p onClick={() => {}}>{a()}</p>
            </Loading>
            <Loading fallback={<span>lb</span>}>
              <p onClick={() => {}}>{b()}</p>
            </Loading>
          </Reveal>
          <button onClick={() => {}}>go</button>
        </div>
      );
    });
    dump("together-ooo", chunks);
  });

  test("sequential: two siblings, B resolves before A", async () => {
    const chunks = await collectChunks(() => {
      const a = createMemo(async () => asyncValue("AAA", 40));
      const b = createMemo(async () => asyncValue("BBB", 10));
      return (
        <div>
          <Reveal order="sequential">
            <Loading fallback={<span>la</span>}>
              <p onClick={() => {}}>{a()}</p>
            </Loading>
            <Loading fallback={<span>lb</span>}>
              <p onClick={() => {}}>{b()}</p>
            </Loading>
          </Reveal>
          <button onClick={() => {}}>go</button>
        </div>
      );
    });
    dump("sequential-ooo", chunks);
  });

  test("sequential collapsed: three siblings, middle resolves first", async () => {
    const chunks = await collectChunks(() => {
      const a = createMemo(async () => asyncValue("AAA", 50));
      const b = createMemo(async () => asyncValue("BBB", 10));
      const c = createMemo(async () => asyncValue("CCC", 30));
      return (
        <div>
          <Reveal order="sequential" collapsed>
            <Loading fallback={<span>la</span>}>
              <p onClick={() => {}}>{a()}</p>
            </Loading>
            <Loading fallback={<span>lb</span>}>
              <p onClick={() => {}}>{b()}</p>
            </Loading>
            <Loading fallback={<span>lc</span>}>
              <p onClick={() => {}}>{c()}</p>
            </Loading>
          </Reveal>
          <button onClick={() => {}}>go</button>
        </div>
      );
    });
    dump("collapsed-ooo", chunks);
  });

  test("together: nested Loading inside outer Loading (draft 17 client side)", async () => {
    function Inner() {
      const slow = createMemo(async () => asyncValue("inner-slow", 80));
      return <span onClick={() => {}}>{slow()}</span>;
    }
    function Outer() {
      const fast = createMemo(async () => asyncValue("outer-fast", 10));
      return (
        <div>
          <em onClick={() => {}}>{fast()}</em>
          <Loading fallback={<i>inner loading</i>}>
            <Inner />
          </Loading>
        </div>
      );
    }
    const chunks = await collectChunks(() => (
      <Reveal order="together">
        <Loading fallback={<b>outer loading</b>}>
          <Outer />
        </Loading>
      </Reveal>
    ));
    dump("nested-together", chunks);
  });

  test("together: two direct slots + nested Loading in first", async () => {
    function SlotA() {
      const fast = createMemo(async () => asyncValue("A-fast", 15));
      const nested = createMemo(async () => asyncValue("A-nested", 90));
      return (
        <div>
          <p onClick={() => {}}>{fast()}</p>
          <Loading fallback={<i>na</i>}>
            <span onClick={() => {}}>{nested()}</span>
          </Loading>
        </div>
      );
    }
    function SlotB() {
      const mid = createMemo(async () => asyncValue("B-mid", 40));
      return <p onClick={() => {}}>{mid()}</p>;
    }
    const chunks = await collectChunks(() => (
      <div>
        <Reveal order="together">
          <Loading fallback={<b>fa</b>}>
            <SlotA />
          </Loading>
          <Loading fallback={<b>fb</b>}>
            <SlotB />
          </Loading>
        </Reveal>
        <button onClick={() => {}}>go</button>
      </div>
    ));
    dump("together-nested-sibling", chunks);
  });

  test("together: nested Loading resolves BEFORE the group releases", async () => {
    function SlotA() {
      const fast = createMemo(async () => asyncValue("A-fast", 10));
      const nested = createMemo(async () => asyncValue("A-nested", 25));
      return (
        <div>
          <p onClick={() => {}}>{fast()}</p>
          <Loading fallback={<i>na</i>}>
            <span onClick={() => {}}>{nested()}</span>
          </Loading>
        </div>
      );
    }
    function SlotB() {
      const slow = createMemo(async () => asyncValue("B-slow", 60));
      return <p onClick={() => {}}>{slow()}</p>;
    }
    const chunks = await collectChunks(() => (
      <div>
        <Reveal order="together">
          <Loading fallback={<b>fa</b>}>
            <SlotA />
          </Loading>
          <Loading fallback={<b>fb</b>}>
            <SlotB />
          </Loading>
        </Reveal>
        <button onClick={() => {}}>go</button>
      </div>
    ));
    dump("nested-early", chunks);
  });

  test("no Reveal: inner Loading resolves BEFORE outer Loading", async () => {
    function Inner() {
      const fast = createMemo(async () => asyncValue("inner-early", 20));
      return <span onClick={() => {}}>{fast()}</span>;
    }
    function Outer() {
      const slow = createMemo(async () => asyncValue("outer-late", 45));
      return (
        <div>
          <p onClick={() => {}}>{slow()}</p>
          <Loading fallback={<i>ni</i>}>
            <Inner />
          </Loading>
        </div>
      );
    }
    const chunks = await collectChunks(() => (
      <div>
        <Loading fallback={<b>fo</b>}>
          <Outer />
        </Loading>
        <button onClick={() => {}}>go</button>
      </div>
    ));
    dump("plain-nested-early", chunks);
  });
});
