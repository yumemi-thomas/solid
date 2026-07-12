/**
 * @jsxImportSource @solidjs/web
 *
 * HUNT5 protocol audit: `transparent: true` memos/effects.
 * Client core (solid-signals core.ts:425-431) makes transparent computeds share the
 * parent id WITHOUT consuming a child-id slot. The server createMemo/createSyncMemo
 * (packages/solid/src/server/signals.ts) ignore options.transparent and always
 * createOwner() -> consume a slot. Every element/computation after a transparent
 * memo therefore has a shifted _hk on the server vs the client claim order.
 */
import { describe, expect, test } from "vitest";
import { renderToString } from "@solidjs/web";
import { createMemo } from "solid-js";

describe("transparent memo id parity", () => {
  test("transparent memo does not consume a hydration id slot", () => {
    function App() {
      const t = createMemo(() => "x", { transparent: true } as any);
      return <div>{t()}</div>;
    }
    const html = renderToString(() => <App />);
    // Client: transparent memo consumes no slot -> <div> claims _hk=0.
    expect(html).toContain("_hk=0");
  });

  test("control: normal memo consumes one slot on both sides", () => {
    function App() {
      const t = createMemo(() => "x");
      return <div>{t()}</div>;
    }
    const html = renderToString(() => <App />);
    expect(html).toContain("_hk=1");
  });
});
