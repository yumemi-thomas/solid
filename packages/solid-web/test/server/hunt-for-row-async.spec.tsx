/**
 * @jsxImportSource @solidjs/web
 */
// Bug hunt: per-row async memos inside <For>/<Repeat>. mapArray's SSR memo
// (solid/src/server/signals.ts) does not reset its owner's `_childCount`
// between engine retry pulls; each re-pull re-runs mapFn, allocating NEW row
// ids and NEW async memos (fresh fetch per pass) — suspected infinite refetch
// loop and/or hydration-id drift.
import { describe, expect, test } from "vitest";
import { renderToStream, Loading, For } from "@solidjs/web";
import { createMemo } from "solid-js";

function renderComplete(code: () => any, options: any = {}): Promise<string> {
  return new Promise(resolve => {
    renderToStream(code, options).then(resolve);
  });
}

function asyncValue<T>(value: T, ms = 10): Promise<T> {
  return new Promise(r => setTimeout(() => r(value), ms));
}

describe("hunt: per-row async memo in For", () => {
  test("each row fetches exactly once and the stream completes", async () => {
    let fetches = 0;
    function Row(props: { id: number }) {
      const detail = createMemo(async () => {
        fetches++;
        return asyncValue(`detail-${props.id}`, 10);
      });
      return <li>{detail()}</li>;
    }

    const htmlPromise = renderComplete(() => (
      <Loading fallback={<span>Loading list...</span>}>
        <ul>
          <For each={[1, 2]}>{id => <Row id={id} />}</For>
        </ul>
      </Loading>
    ));

    const html = await Promise.race([
      htmlPromise,
      new Promise<string>((_, rej) =>
        setTimeout(() => rej(new Error(`stream never completed; fetches=${fetches}`)), 3000)
      )
    ]);

    expect(html).toContain("detail-1");
    expect(html).toContain("detail-2");
    expect(fetches).toBe(2);
  });
});
