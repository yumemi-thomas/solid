/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// Scratch spec — client-side halves of the SSR/CSR control-flow asymmetry audit.
// Not intended to be committed; each test documents observed client behavior to
// diff against the server probes.
import { describe, expect, test } from "vitest";
import { Show, Switch, Match, Repeat, For, Errored, Loading, flush } from "solid-js";
import { render, dynamic } from "../src/index.js";

function mount(code: () => any): { div: HTMLDivElement; dispose: () => void } {
  const div = document.createElement("div");
  const dispose = render(code, div);
  flush();
  return { div, dispose };
}

const tick = () => new Promise(r => setTimeout(r, 0));

describe("client halves of SSR asymmetry probes", () => {
  test("Show when=Promise resolving to object (keyed)", async () => {
    let received: any = "NOT-CALLED";
    const { div, dispose } = mount(() => (
      <Loading fallback={<span>LOADING</span>}>
        <Show when={Promise.resolve({ name: "Ada" })} keyed>
          {(u: any) => {
            received = u;
            return <span>user:{u instanceof Promise ? "PROMISE" : (u as any).name}</span>;
          }}
        </Show>
      </Loading>
    ));
    console.log("[client show-promise-keyed initial]", div.innerHTML);
    await tick();
    flush();
    await tick();
    flush();
    console.log("[client show-promise-keyed settled]", div.innerHTML, "received:", received);
    dispose();
  });

  test("Show when=Promise resolving to false", async () => {
    const { div, dispose } = mount(() => (
      <Loading fallback={<span>LOADING</span>}>
        <Show when={Promise.resolve(false)} fallback={<span>FALLBACK</span>}>
          <span>CHILDREN</span>
        </Show>
      </Loading>
    ));
    console.log("[client show-promise-false initial]", div.innerHTML);
    await tick();
    flush();
    await tick();
    flush();
    console.log("[client show-promise-false settled]", div.innerHTML);
    dispose();
  });

  test("Switch with null children", () => {
    const { div, dispose } = mount(() => (
      <Switch fallback={<span>NOTFOUND</span>}>{null as any}</Switch>
    ));
    console.log("[client switch-null]", div.innerHTML);
    dispose();
  });

  test("Switch match + null sibling, first falsy", () => {
    let threw: any = null;
    try {
      const { div, dispose } = mount(() => (
        <Switch fallback={<span>NOTFOUND</span>}>
          <Match when={false}>A</Match>
          {null as any}
        </Switch>
      ));
      console.log("[client switch-null-sibling]", div.innerHTML);
      dispose();
    } catch (e: any) {
      threw = e;
      console.log("[client switch-null-sibling] THREW:", e?.message);
    }
  });

  test("Repeat count edge cases", () => {
    for (const [label, count] of [
      ["NaN", NaN],
      ["undefined", undefined],
      ["negative", -3]
    ] as const) {
      try {
        const { div, dispose } = mount(() => (
          <Repeat count={count as any} fallback={<span>EMPTY</span>}>
            {(i: number) => <span>row{i};</span>}
          </Repeat>
        ));
        console.log(`[client repeat-${label}]`, JSON.stringify(div.innerHTML));
        dispose();
      } catch (e: any) {
        console.log(`[client repeat-${label}] THREW:`, e?.message);
      }
    }
  });

  test("For each = plain object", () => {
    try {
      const { div, dispose } = mount(() => (
        <For each={{ a: 1 } as any} fallback={<span>EMPTY</span>}>
          {(x: any) => <span>item</span>}
        </For>
      ));
      console.log("[client for-object]", JSON.stringify(div.innerHTML));
      dispose();
    } catch (e: any) {
      console.log("[client for-object] THREW:", e?.message);
    }
  });
});
