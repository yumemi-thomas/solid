/**
 * @jsxImportSource @solidjs/web
 */
// Bug hunt: a Loading FALLBACK that throws a real (non-NotReady) error while
// the boundary's children are pending, with an <Errored> above. Expected: the
// error propagates to the Errored boundary and its fallback renders (client
// behavior). Suspect: the throw escapes createLoadingBoundary's fallback
// rendering path (hydration.ts:180-187) outside the boundary error context.
import { describe, expect, test } from "vitest";
import { renderToStream, Loading, Errored } from "@solidjs/web";
import { createMemo } from "solid-js";

function renderComplete(code: () => any, options: any = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      renderToStream(code, options).then(resolve);
    } catch (e) {
      reject(e);
    }
  });
}

function asyncValue<T>(value: T, ms = 10): Promise<T> {
  return new Promise(r => setTimeout(() => r(value), ms));
}

describe("hunt: Loading fallback throws", () => {
  test("sync-throwing Loading fallback is caught by surrounding Errored", async () => {
    function BadFallback(): any {
      throw new Error("fallback exploded");
    }
    function Child() {
      const data = createMemo(async () => asyncValue("late data", 20));
      return <span>{data()}</span>;
    }

    const html = await Promise.race([
      renderComplete(() => (
        <Errored fallback={err => <span>caught: {String((err() as Error)?.message)}</span>}>
          <Loading fallback={<BadFallback />}>
            <Child />
          </Loading>
        </Errored>
      )),
      new Promise<string>((_, rej) =>
        setTimeout(() => rej(new Error("stream never completed")), 3000)
      )
    ]);

    // NOTE: behaves correctly — Errored catches the fallback's error
    // (hydration marker <!--$--> sits between static and dynamic text).
    expect(html).toMatch(/caught: (<!--\$-->)?fallback exploded/);
  });
});
