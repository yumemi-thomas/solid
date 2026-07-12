// 1.x check for finding 8: does lazy() inside <NoHydration> render its content during SSR?
import { describe, expect, test } from "vitest";
import { renderToStringAsync, NoHydration } from "solid-js/web";
import { lazy, Suspense } from "solid-js";

const LazyComp = lazy(async () => ({ default: () => <p>lazy content</p> }));

describe("1.x SSR: lazy inside NoHydration", () => {
  test("renders the lazy component's content", async () => {
    const html = await renderToStringAsync(() => (
      <Suspense fallback={<div>loading</div>}>
        <NoHydration>
          <LazyComp />
        </NoHydration>
      </Suspense>
    ));
    console.log("[08] NoHydration lazy html:", html);
    expect(html).toContain("lazy content");
  });

  test("control: lazy outside NoHydration renders", async () => {
    const html = await renderToStringAsync(() => (
      <Suspense fallback={<div>loading</div>}>
        <LazyComp />
      </Suspense>
    ));
    expect(html).toContain("lazy content");
  });
});
