/**
 * @jsxImportSource @solidjs/web
 *
 * HUNT5 protocol audit: <Show when={...}> with an async (Promise) condition.
 * Client Show (packages/solid/src/client/flow.ts) deliberately keeps its
 * conditionValue memo async-shape aware ("a Promise/AsyncIterable returned by
 * the user's reactive expression flows through handleAsync") — the child sees
 * the RESOLVED value. Server Show (packages/solid/src/server/flow.ts) reads
 * `props.when` inside a `sync: true` memo — a returned Promise is treated as a
 * plain truthy object and passed raw to the keyed child.
 */
import { describe, expect, test } from "vitest";
import { renderToStream, Loading, Show } from "@solidjs/web";

function renderComplete(code: () => any, options: any = {}): Promise<string> {
  return new Promise(resolve => {
    renderToStream(code, options).then(resolve);
  });
}

function asyncValue<T>(value: T, ms = 10): Promise<T> {
  return new Promise(r => setTimeout(() => r(value), ms));
}

describe("Show async when parity", () => {
  test("keyed child receives the resolved value, not the raw Promise", async () => {
    function App() {
      return (
        <Loading fallback={<p>loading</p>}>
          <Show when={asyncValue({ name: "Ada" })} keyed>
            {(u: any) => <div>{u.name}</div>}
          </Show>
        </Loading>
      );
    }
    const html = await renderComplete(() => <App />);
    expect(html).toContain("Ada");
  });
});
