/**
 * @jsxImportSource @solidjs/web
 * Wave 3 SSR HTML generator — captures actual server output for hydrate probes.
 */
import { describe, expect, test } from "vitest";
import { renderToString } from "@solidjs/web";
import { createSignal, NoHydration, Hydration, Show, For, Switch, Match, Repeat } from "solid-js";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const outDir = resolve(dirname(fileURLToPath(import.meta.url)), "../hydration/__hunt3__");

describe("hunt3 server html generator", () => {
  test("capture form + NoHydration SSR shapes", () => {
    mkdirSync(outDir, { recursive: true });
    const out: Record<string, string> = {};

    out.select = renderToString(() => {
      const [sel] = createSignal("b");
      return (
        <div>
          <select value={sel()} onChange={() => {}}>
            <option value="a">A</option>
            <option value="b">B</option>
            <option value="c">C</option>
          </select>
        </div>
      );
    });

    out.selectFirst = renderToString(() => {
      const [sel] = createSignal("a");
      return (
        <div>
          <select value={sel()} onChange={() => {}}>
            <option value="a">A</option>
            <option value="b">B</option>
          </select>
        </div>
      );
    });

    out.textarea = renderToString(() => {
      const [v] = createSignal("hello\nworld");
      return (
        <div>
          <textarea value={v()} onInput={() => {}} />
        </div>
      );
    });

    out.checkbox = renderToString(() => {
      const [c] = createSignal(true);
      return (
        <div>
          <input type="checkbox" checked={c()} onChange={() => {}} />
        </div>
      );
    });

    out.checkboxUnchecked = renderToString(() => {
      const [c] = createSignal(false);
      return (
        <div>
          <input type="checkbox" checked={c()} onChange={() => {}} />
        </div>
      );
    });

    out.textInput = renderToString(() => {
      const [v] = createSignal("server");
      return (
        <div>
          <input type="text" value={v()} onInput={() => {}} />
        </div>
      );
    });

    out.formBundle = renderToString(() => {
      const [v] = createSignal("world");
      const [sel] = createSignal("b");
      const [chk] = createSignal(true);
      return (
        <div>
          <textarea value={v()} onInput={() => {}} />
          <select value={sel()} onChange={() => {}}>
            <option value="a">A</option>
            <option value="b">B</option>
          </select>
          <input type="checkbox" checked={chk()} onChange={() => {}} />
          <input type="text" value={v()} onInput={() => {}} />
        </div>
      );
    });

    // Nested Hydration inside NoHydration — server re-establishes id namespace
    out.nestedHydration = renderToString(() => {
      const [t] = createSignal(0);
      return (
        <div>
          <span>outer</span>
          <NoHydration>
            <span>static-nohk</span>
            <Hydration>
              <button onClick={() => {}}>n:{t()}</button>
            </Hydration>
          </NoHydration>
          <button onClick={() => {}}>o:{t()}</button>
        </div>
      );
    });

    out.nestedHydrationWithId = renderToString(() => {
      const [t] = createSignal(0);
      return (
        <div>
          <NoHydration>
            <span>shell</span>
            <Hydration id="island">
              <button onClick={() => {}}>i:{t()}</button>
            </Hydration>
          </NoHydration>
        </div>
      );
    });

    out.noHydrationSibling = renderToString(() => {
      const [t] = createSignal(0);
      return (
        <div>
          <NoHydration>
            <span>static</span>
          </NoHydration>
          <button onClick={() => {}}>b:{t()}</button>
        </div>
      );
    });

    // Portal is client-only — server should throw or omit
    try {
      out.portal = renderToString(() => {
        const { Portal } = require("@solidjs/web") as typeof import("@solidjs/web");
        return (
          <div>
            before
            <Portal>
              <p>ported</p>
            </Portal>
            after
          </div>
        );
      });
    } catch (e: any) {
      out.portal = `THREW: ${e?.message ?? e}`;
    }

    out.showTrue = renderToString(() => {
      const [on] = createSignal(true);
      return (
        <div>
          <Show when={on()} fallback={<span>no</span>}>
            <span>yes</span>
          </Show>
          <button>go</button>
        </div>
      );
    });

    out.showFalse = renderToString(() => {
      const [on] = createSignal(false);
      return (
        <div>
          <Show when={on()} fallback={<span>off</span>}>
            <span>on</span>
          </Show>
          <button>toggle</button>
        </div>
      );
    });

    out.forItems = renderToString(() => {
      const [items] = createSignal(["alpha", "beta", "gamma"]);
      return (
        <div>
          <ul>
            <For each={items()}>{item => <li>{item}</li>}</For>
          </ul>
          <button>swap</button>
        </div>
      );
    });

    out.forEmpty = renderToString(() => {
      const [items] = createSignal<string[]>([]);
      return (
        <div>
          <ul>
            <For each={items()} fallback={<li>empty</li>}>
              {item => <li>{item}</li>}
            </For>
          </ul>
        </div>
      );
    });

    out.switchOne = renderToString(() => {
      const [n] = createSignal(1);
      return (
        <div>
          <Switch>
            <Match when={n() === 1}>
              <span>one</span>
            </Match>
            <Match when={n() === 2}>
              <span>two</span>
            </Match>
          </Switch>
          <button>go</button>
        </div>
      );
    });

    out.repeat3 = renderToString(() => {
      const [count] = createSignal(3);
      return (
        <div>
          <ul>
            <Repeat count={count()}>{i => <li>{i}</li>}</Repeat>
          </ul>
          <button>go</button>
        </div>
      );
    });

    writeFileSync(resolve(outDir, "ssr.json"), JSON.stringify(out, null, 2));

    // Also assert visibly in the test runner so we see shapes without opening the file
    for (const [k, v] of Object.entries(out)) {
      // eslint-disable-next-line no-console
      console.log(`\n=== ${k} ===\n${v}`);
    }
    expect(out.select).toBeTruthy();
    expect(out.textarea).toBeTruthy();
    expect(out.checkbox).toBeTruthy();
    expect(out.textInput).toBeTruthy();
  });
});
