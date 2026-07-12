/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * Hybrid SSR-to-DOM repro for issue draft 01. This renders a realistic page
 * through renderToStream, applies each chunk to a browser DOM, executes the
 * emitted activation scripts in arrival order, and records what a user could
 * actually see after every chunk.
 */
import { afterEach, beforeEach, expect, test } from "vitest";
import { renderToStream, Loading, Reveal } from "@solidjs/web";
import { createMemo } from "solid-js";

const fetchIn = <T,>(value: T, ms: number): Promise<T> =>
  new Promise(resolve => setTimeout(() => resolve(value), ms));

function applyChunk(container: HTMLDivElement, chunk: string, first: boolean) {
  const scriptRe = /<script(?:[^>]*)>([\s\S]*?)<\/script>/g;
  const scripts = [...chunk.matchAll(scriptRe)].map(match => match[1]);
  const markup = chunk.replace(scriptRe, "");
  if (first) container.innerHTML = markup;
  else container.insertAdjacentHTML("beforeend", markup);
  for (const script of scripts) (0, eval)(script);
}

async function streamVisibleTimeline() {
  function Recommendations() {
    const recommendations = createMemo(async () => fetchIn("Camp Stove", 80));
    return <span>{recommendations()}</span>;
  }

  function ProductDetails() {
    const product = createMemo(async () => fetchIn("Trail Pack", 10));
    return (
      <section>
        <h1>{product()}</h1>
        <Loading fallback={<i>loading recommendations…</i>}>
          <Recommendations />
        </Loading>
      </section>
    );
  }

  function Reviews() {
    const reviews = createMemo(async () => fetchIn("4.8 stars", 40));
    return <aside>{reviews()}</aside>;
  }

  const container = document.body.appendChild(document.createElement("div"));
  const timeline: string[] = [];
  let first = true;

  await new Promise<void>(resolve => {
    renderToStream(() => (
      <Reveal order="together">
        <Loading fallback={<b>loading product…</b>}>
          <ProductDetails />
        </Loading>
        <Loading fallback={<b>loading reviews…</b>}>
          <Reviews />
        </Loading>
      </Reveal>
    )).pipe({
      write(chunk: string) {
        applyChunk(container, chunk, first);
        first = false;
        timeline.push(container.textContent ?? "");
      },
      end() {
        resolve();
      }
    });
  });

  return timeline;
}

beforeEach(() => {
  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
});

afterEach(() => {
  document.body.innerHTML = "";
});

test("ready primary content is visible while a nested secondary widget is still loading", async () => {
  const timeline = await streamVisibleTimeline();

  expect(timeline).toContain("loading product…loading reviews…");
  expect(timeline).toContain("Trail Packloading recommendations…4.8 stars");
  expect(timeline.at(-1)).toBe("Trail PackCamp Stove4.8 stars");
});
