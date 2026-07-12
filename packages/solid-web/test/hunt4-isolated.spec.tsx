/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// Scratch spec — isolated client rejection probes (audit; not for commit).
import { describe, test } from "vitest";
import { render, dynamic } from "../src/index.js";
import { createMemo, Errored, Loading, flush } from "solid-js";

function deferred<T = any>() {
  let resolve!: (value: T) => void;
  let reject!: (error?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
  flush();
  await Promise.resolve();
  flush();
}

describe("isolated rejection probes", () => {
  test("memo rejection truthy", async () => {
    const d = deferred<number>();
    const data = createMemo(async () => (await d.promise) + 1);
    const div = document.createElement("div");
    const dispose = render(
      () => (
        <Errored fallback={e => <div>ERROR:{String(e())}</div>}>
          <Loading fallback={<div>LOADING</div>}>
            <div>value:{data()}</div>
          </Loading>
        </Errored>
      ),
      div
    );
    flush();
    console.log("[iso memo-truthy initial]", JSON.stringify(div.textContent));
    d.reject(new Error("boom"));
    await settle();
    console.log("[iso memo-truthy settled]", JSON.stringify(div.textContent));
    dispose();
  });

  test("memo rejection falsy", async () => {
    const d = deferred<number>();
    const data = createMemo(async () => (await d.promise) + 1);
    const div = document.createElement("div");
    const dispose = render(
      () => (
        <Errored fallback={e => <div>ERROR:{String(e())}</div>}>
          <Loading fallback={<div>LOADING</div>}>
            <div>value:{data()}</div>
          </Loading>
        </Errored>
      ),
      div
    );
    flush();
    console.log("[iso memo-falsy initial]", JSON.stringify(div.textContent));
    d.reject(undefined);
    await settle();
    console.log("[iso memo-falsy settled]", JSON.stringify(div.textContent));
    dispose();
  });

  test("dynamic rejection truthy", async () => {
    const d = deferred<any>();
    const C = dynamic(() => d.promise);
    const div = document.createElement("div");
    const dispose = render(
      () => (
        <Errored fallback={e => <div>ERROR:{String(e())}</div>}>
          <Loading fallback={<div>LOADING</div>}>
            <C />
          </Loading>
        </Errored>
      ),
      div
    );
    flush();
    console.log("[iso dyn-truthy initial]", JSON.stringify(div.textContent));
    d.reject(new Error("boom"));
    await settle();
    console.log("[iso dyn-truthy settled]", JSON.stringify(div.textContent));
    dispose();
  });

  test("dynamic rejection falsy", async () => {
    const d = deferred<any>();
    const C = dynamic(() => d.promise);
    const div = document.createElement("div");
    const dispose = render(
      () => (
        <Errored fallback={e => <div>ERROR:{String(e())}</div>}>
          <Loading fallback={<div>LOADING</div>}>
            <C />
          </Loading>
        </Errored>
      ),
      div
    );
    flush();
    console.log("[iso dyn-falsy initial]", JSON.stringify(div.textContent));
    d.reject(undefined);
    await settle();
    console.log("[iso dyn-falsy settled]", JSON.stringify(div.textContent));
    dispose();
  });
});
