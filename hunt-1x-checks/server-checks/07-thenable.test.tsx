// 1.x check for finding 7: do non-Promise thenables (Knex/mongoose-style PromiseLike) work in SSR?
import { describe, expect, test } from "vitest";
import { renderToStringAsync } from "solid-js/web";
import { createResource, Suspense } from "solid-js";

function makeThenable<T>(value: T): PromiseLike<T> {
  return {
    then(onFulfilled: any) {
      // resolve async like a query builder would
      const p = Promise.resolve(value).then(onFulfilled);
      return p as any;
    }
  };
}

function Inner() {
  const [data] = createResource(() => makeThenable("from-thenable") as any);
  return <div>value:{data()}</div>;
}

describe("1.x SSR: non-Promise thenable from a resource", () => {
  test("renderToStringAsync resolves the thenable and renders the value", async () => {
    const html = await renderToStringAsync(() => (
      <Suspense fallback={<div>loading</div>}>
        <Inner />
      </Suspense>
    ));
    console.log("[07] thenable html:", html);
    expect(html).toContain("from-thenable");
  });
});
