/**
 * @jsxImportSource @solidjs/web
 * TEMPORARY generator — captures server HTML for hydration hunt tests.
 */
import { describe, test } from "vitest";
import { renderToString } from "@solidjs/web";
import { createSignal, createMemo, createEffect, For, Show } from "solid-js";

describe("hunt2 server html generator", () => {
  test("generate", async () => {
    const out: Record<string, string> = {};

    // 1. For list
    out.forList = renderToString(() => {
      const [items] = createSignal([
        { id: "a", label: "alpha" },
        { id: "b", label: "beta" },
        { id: "c", label: "gamma" }
      ]);
      return (
        <div>
          <ul>
            <For each={items()}>{item => <li onClick={() => {}}>{item.label}</li>}</For>
          </ul>
          <button onClick={() => {}}>swap</button>
        </div>
      );
    });

    // 2. Show + sibling
    out.showApp = renderToString(() => {
      const [s] = createSignal(false);
      return (
        <div>
          <Show when={s()} fallback={<span>off</span>}>
            <span>on</span>
          </Show>
          <button onClick={() => {}}>toggle</button>
        </div>
      );
    });

    // 3. dynamic sole text child
    out.soleText = renderToString(() => {
      const [t] = createSignal("hello");
      return (
        <div>
          <p>{t()}</p>
        </div>
      );
    });

    // 3b. text with static prefix
    out.prefixText = renderToString(() => {
      const [t] = createSignal(0);
      return (
        <div>
          <button onClick={() => {}}>Count: {t()}</button>
        </div>
      );
    });

    // 4. textarea + select + checkbox
    out.formEls = renderToString(() => {
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

    // 5. two buttons with delegated handlers (event replay)
    out.twoButtons = renderToString(() => {
      return (
        <div>
          <button onClick={() => {}}>A</button>
          <button onClick={() => {}}>B</button>
        </div>
      );
    });

    // 6. memo of JSX + effect id parity probe
    out.effectApp = renderToString(() => {
      const [t] = createSignal("x");
      createEffect(
        () => t(),
        () => {}
      );
      const inner = createMemo(() => <span>{t()}</span>);
      return (
        <div>
          {inner()}
          <button onClick={() => {}}>go</button>
        </div>
      );
    });

    // 7. NoHydration with hydrated sibling
    const { NoHydration } = await import("solid-js");
    out.noHydrationApp = renderToString(() => {
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

    // 8. For with fallback, list empty on server
    out.forFallback = renderToString(() => {
      const [items] = createSignal<string[]>([]);
      return (
        <div>
          <ul>
            <For each={items()} fallback={<li>empty</li>}>
              {item => <li>{item}</li>}
            </For>
          </ul>
          <button onClick={() => {}}>add</button>
        </div>
      );
    });

    // 8b. two islands with renderId
    out.islandA = renderToString(
      () => {
        const [t] = createSignal(0);
        return (
          <div>
            <button onClick={() => {}}>a:{t()}</button>
          </div>
        );
      },
      { renderId: "ia" } as any
    );
    out.islandB = renderToString(
      () => {
        const [t] = createSignal(0);
        return (
          <div>
            <button onClick={() => {}}>b:{t()}</button>
          </div>
        );
      },
      { renderId: "ib" } as any
    );

    // 8c. Dynamic string tag
    const { Dynamic } = await import("@solidjs/web");
    out.dynamicApp = renderToString(() => {
      const [tag] = createSignal("em");
      return (
        <div>
          <Dynamic component={tag() as any} onClick={() => {}}>
            dyn
          </Dynamic>
          <button onClick={() => {}}>x</button>
        </div>
      );
    });

    // 9. ref app
    out.refApp = renderToString(() => {
      let r: any;
      return (
        <div>
          <p ref={el => (r = el)}>hello</p>
        </div>
      );
    });

    (await import("fs")).writeFileSync(
      "/private/tmp/claude-501/-Users-thomas-Documents-Github-solid/06794401-a08a-49d1-bcd4-095380410722/scratchpad/gen1.json",
      JSON.stringify(out, null, 2)
    );
  });

  test("generate streamed chunks — two sibling boundaries out of order", async () => {
    const { renderToStream } = await import("@solidjs/web");
    const { Loading } = await import("solid-js");
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

    const chunks: string[] = [];
    let done!: () => void;
    const p = new Promise<void>(r => (done = r));

    renderToStream(() => {
      const [label] = createSignal("go");
      const a = createMemo(async () => {
        await sleep(40);
        return "AAA";
      });
      const b = createMemo(async () => {
        await sleep(10);
        return "BBB";
      });
      return (
        <div>
          <Loading fallback={<span>la</span>}>
            <p onClick={() => {}}>{a()}</p>
          </Loading>
          <Loading fallback={<span>lb</span>}>
            <p onClick={() => {}}>{b()}</p>
          </Loading>
          <button onClick={() => {}}>{label()}</button>
        </div>
      );
    }).pipe({
      write(v: string) {
        chunks.push(v);
      },
      end() {
        done();
      }
    });
    await p;

    (await import("fs")).writeFileSync(
      "/private/tmp/claude-501/-Users-thomas-Documents-Github-solid/06794401-a08a-49d1-bcd4-095380410722/scratchpad/gen-stream.json",
      JSON.stringify(chunks, null, 2)
    );
  });
});
