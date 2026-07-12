/** @jsxImportSource @solidjs/web */
import { JSDOM } from "jsdom";
import { performance } from "node:perf_hooks";
import { renderToStream } from "@solidjs/web";
import { createMemo, Loading, Reveal } from "solid-js";

const fetchIn = <T,>(value: T, ms: number): Promise<T> =>
  new Promise(resolve => setTimeout(() => resolve(value), ms));

type Snapshot = { at: number; text: string };

function applyChunk(dom: JSDOM, chunk: string, first: boolean) {
  const scriptRe = /<script(?:[^>]*)>([\s\S]*?)<\/script>/g;
  const scripts = [...chunk.matchAll(scriptRe)].map(match => match[1]);
  const markup = chunk.replace(scriptRe, "");
  const body = dom.window.document.body;

  if (first) body.innerHTML = markup;
  else body.insertAdjacentHTML("beforeend", markup);
  for (const script of scripts) dom.window.eval(script);
}

async function run(label: string, withRecommendations: boolean) {
  function Recommendations() {
    // Secondary data is deliberately much slower than the primary page data.
    const recommendations = createMemo(async () => fetchIn("Camp Stove", 600));
    return <span>{recommendations()}</span>;
  }

  function ProductDetails() {
    const product = createMemo(async () => fetchIn("Trail Pack", 40));
    return (
      <section>
        <h1>{product()}</h1>
        {withRecommendations && (
          <Loading fallback={<i>loading recommendations…</i>}>
            <Recommendations />
          </Loading>
        )}
      </section>
    );
  }

  function Reviews() {
    const reviews = createMemo(async () => fetchIn("4.8 stars", 120));
    return <aside>{reviews()}</aside>;
  }

  const dom = new JSDOM("<!doctype html><body></body>", { runScripts: "outside-only" });
  const runtime = dom.window as any;
  runtime._$HY = { events: [], completed: new runtime.WeakSet(), r: {}, fe() {} };

  const started = performance.now();
  const snapshots: Snapshot[] = [];
  let first = true;
  let previous = "";

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
        applyChunk(dom, chunk, first);
        first = false;
        const text = dom.window.document.body.textContent ?? "";
        if (text !== previous) {
          snapshots.push({ at: Math.round(performance.now() - started), text });
          previous = text;
        }
      },
      end() {
        resolve();
      }
    });
  });

  const primaryVisible = snapshots.find(
    snapshot => snapshot.text.includes("Trail Pack") && snapshot.text.includes("4.8 stars")
  );
  const usefulIntermediate = snapshots.find(
    snapshot =>
      snapshot.text.includes("Trail Pack") &&
      snapshot.text.includes("4.8 stars") &&
      snapshot.text.includes("loading recommendations…")
  );

  console.log(`\n${label}`);
  for (const snapshot of snapshots) console.log(`  @${snapshot.at}ms  ${snapshot.text}`);
  console.log(`  primary content first visible: ~${primaryVisible?.at ?? "never"}ms`);
  return { snapshots, primaryVisible, usefulIntermediate };
}

const control = await run("CONTROL — product + reviews", false);
const nested = await run("NESTED — same page + recommendations widget", true);

const addedDelay =
  control.primaryVisible && nested.primaryVisible
    ? nested.primaryVisible.at - control.primaryVisible.at
    : Number.NaN;
const reproduced = !nested.usefulIntermediate && addedDelay > 300;

console.log(`\nAdded wait before primary content is visible: ~${addedDelay}ms`);
console.log(
  reproduced
    ? "FAIL — bug reproduced: a secondary nested widget held the ready primary page"
    : "PASS — direct slots revealed while the nested widget kept its own fallback"
);
