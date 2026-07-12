// 1.x check for wave-2 SSR finding: <Assets>/useAssets with element children
import { describe, expect, test } from "vitest";
import { renderToStringAsync, HydrationScript, NoHydration } from "solid-js/web";
import { useAssets } from "solid-js/web";

function App() {
  useAssets(() => <link rel="stylesheet" href="/x.css" />);
  return <div>body</div>;
}

describe("1.x SSR: useAssets with an element child", () => {
  test("renders the asset into <head> without crashing", async () => {
    const html = await renderToStringAsync(() => (
      <html>
        <head></head>
        <body>
          <App />
        </body>
      </html>
    ));
    console.log("[w2-assets] html:", html);
    expect(html).toContain("x.css");
    expect(html).toContain("body");
  });
});
