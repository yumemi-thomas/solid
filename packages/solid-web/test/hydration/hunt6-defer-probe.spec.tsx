/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * Focused probe: what does a hydrated async memo yield when the server
 * serialized a RAW value (deferStream path) whose own shape is { s: 2, v }
 * or { v } — colliding with the seroval promise-status convention that
 * readHydratedValue() sniffs.
 */
import { describe, expect, test } from "vitest";
import { createMemo, flush, enableHydration, Loading } from "solid-js";
import { hydrate } from "@solidjs/web";

enableHydration();
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function probe(serialized: Record<string, any>, html: string, expected?: any) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: serialized, fe() {} };
  container.innerHTML = html;
  let observed: { value?: any; error?: any } = {};
  let memoRef: any;
  const dispose = hydrate(() => {
    const data = createMemo(async () => {
      await sleep(5);
      return { s: 2, v: "payload" };
    });
    memoRef = data;
    return (
      <Loading fallback={<i>wait</i>}>
        <p>{String(data()?.v)}</p>
      </Loading>
    );
  }, container);
  flush();
  await sleep(30);
  flush();
  try {
    observed.value = memoRef();
  } catch (e) {
    observed.error = e;
  }
  dispose();
  container.remove();
  return observed;
}

describe("hunt6 defer raw-value shape probe", () => {
  test("value { s: 2, v } serialized raw — memo read after hydration", async () => {
    // ids from the artifact: boundary chain gives memo id "0" at root
    const observed = await probe(
      { "0": { s: 2, v: "payload" }, "1_fr": Promise.resolve(true) },
      `<p _hk=100000>payload</p>`
    );
    console.error("OBSERVED:", observed);
    // Protocol intent: memo value should BE the raw object { s: 2, v: "payload" }
    expect(observed.error).toBe(undefined);
    expect(observed.value).toEqual({ s: 2, v: "payload" });
  });

  test("value { v } serialized raw — memo unwraps .v instead of keeping the object", async () => {
    const observed = await probe(
      { "0": { v: "inner" }, "1_fr": Promise.resolve(true) },
      `<p _hk=100000>inner</p>`
    );
    console.error("OBSERVED2:", observed);
    expect(observed.error).toBe(undefined);
    expect(observed.value).toEqual({ v: "inner" });
  });
});
