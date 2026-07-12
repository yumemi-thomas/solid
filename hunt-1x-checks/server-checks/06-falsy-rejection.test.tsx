// 1.x check for finding 6: is a falsy async rejection (reject(undefined)) swallowed during SSR?
import { describe, expect, test } from "vitest";
import { renderToStringAsync } from "solid-js/web";
import { createResource, ErrorBoundary, Suspense } from "solid-js";

function Inner(props: { reason: any }) {
  const [data] = createResource(() => Promise.reject(props.reason));
  return <div>value:{String(data())}</div>;
}

async function run(reason: any) {
  return renderToStringAsync(() => (
    <ErrorBoundary fallback={<div>errored</div>}>
      <Suspense fallback={<div>loading</div>}>
        <Inner reason={reason} />
      </Suspense>
    </ErrorBoundary>
  ));
}

describe("1.x SSR: falsy rejection reaches the error fallback", () => {
  test("reject(undefined) shows the ErrorBoundary fallback", async () => {
    const html = await run(undefined);
    console.log("[06] reject(undefined) html:", html);
    expect(html).toContain("errored");
    expect(html).not.toContain("value:");
  });

  test('reject("") shows the ErrorBoundary fallback', async () => {
    const html = await run("");
    console.log('[06] reject("") html:', html);
    expect(html).toContain("errored");
    expect(html).not.toContain("value:");
  });

  test("control: reject(new Error) shows the ErrorBoundary fallback", async () => {
    const html = await run(new Error("boom"));
    expect(html).toContain("errored");
  });
});
