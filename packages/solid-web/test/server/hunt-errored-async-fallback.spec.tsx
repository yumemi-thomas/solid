/**
 * @jsxImportSource @solidjs/web
 */
// Bug hunt: <Errored> whose FALLBACK itself contains async data. Fix 0e8672ab
// resumed pending holes for the boundary's CHILDREN across retries, but the
// fallback path (`handleError` -> `renderFallback`) re-runs `fallback()` from
// scratch on every retry pull, recreating async memos (fresh fetch each pass).
import { describe, expect, test } from "vitest";
import { renderToStream, Loading, Errored } from "@solidjs/web";
import { createMemo } from "solid-js";

function renderComplete(code: () => any, options: any = {}): Promise<string> {
  return new Promise(resolve => {
    renderToStream(code, options).then(resolve);
  });
}

function asyncValue<T>(value: T, ms = 10): Promise<T> {
  return new Promise(r => setTimeout(() => r(value), ms));
}

describe("hunt: async content inside Errored fallback", () => {
  test("Errored fallback with async memo settles once (no refetch loop)", async () => {
    let fetches = 0;
    function ErrorPanel() {
      const suggestion = createMemo(async () => {
        fetches++;
        return asyncValue("try-again-later", 10);
      });
      return <span>fallback:{suggestion()}</span>;
    }

    function Child(): any {
      throw new Error("child blew up");
    }

    const htmlPromise = renderComplete(() => (
      <Loading fallback={<span>Loading...</span>}>
        <Errored fallback={() => <ErrorPanel />}>
          <Child />
        </Errored>
      </Loading>
    ));

    // guard against a hanging/looping stream
    const html = await Promise.race([
      htmlPromise,
      new Promise<string>((_, rej) =>
        setTimeout(() => rej(new Error(`stream never completed; fetches=${fetches}`)), 3000)
      )
    ]);

    // NOTE: behaves correctly — single fetch, resolved fallback content
    // (hydration marker <!--$--> sits between the static and dynamic text).
    expect(html).toMatch(/fallback:(<!--\$-->)?try-again-later/);
    expect(fetches).toBe(1);
  });
});
