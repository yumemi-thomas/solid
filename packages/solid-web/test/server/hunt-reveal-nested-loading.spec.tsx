/**
 * @jsxImportSource @solidjs/web
 */
// Bug hunt: a Loading boundary NESTED INSIDE another Loading, both under one
// <Reveal order="together">. Per the docs and the client implementation
// (solid-signals/src/boundaries.ts:388 clears RevealControllerContext inside
// every loading boundary), only DIRECT slots participate in the group — the
// nested inner boundary reveals independently once its parent slot revealed.
// The server createLoadingBoundary (solid/src/server/hydration.ts) never
// clears RevealGroupContext for its children, so the nested boundary
// registers as a sibling slot and "together" holds the ENTIRE group hostage
// until the slow nested boundary resolves.
import { describe, expect, test } from "vitest";
import { renderToStream, Loading, Reveal } from "@solidjs/web";
import { createMemo } from "solid-js";

function asyncValue<T>(value: T, ms = 10): Promise<T> {
  return new Promise(r => setTimeout(() => r(value), ms));
}

function collectChunks(code: () => any, options: any = {}): Promise<string[]> {
  return new Promise(resolve => {
    const chunks: string[] = [];
    renderToStream(code, options).pipe({
      write(chunk: string) {
        chunks.push(chunk);
      },
      end() {
        resolve(chunks);
      }
    });
  });
}

describe("hunt: nested Loading inside Reveal group", () => {
  test("together group releases when its single DIRECT slot is ready, not when nested inner resolves", async () => {
    function Inner() {
      const slow = createMemo(async () => asyncValue("inner-slow", 80));
      return <span>{slow()}</span>;
    }
    function Outer() {
      const fast = createMemo(async () => asyncValue("outer-fast", 10));
      return (
        <div>
          {fast()}
          <Loading fallback={<i>inner loading</i>}>
            <Inner />
          </Loading>
        </div>
      );
    }

    const chunks = await collectChunks(() => (
      <Reveal order="together">
        <Loading fallback={<b>outer loading</b>}>
          <Outer />
        </Loading>
      </Reveal>
    ));

    const full = chunks.join("");
    expect(full).toContain("outer-fast");
    expect(full).toContain("inner-slow");

    // The group has exactly ONE direct slot (the outer Loading). Every grouped
    // activation ($dfj([...])) must therefore list exactly one key — the outer
    // boundary. If the nested inner boundary was (incorrectly) registered into
    // the group, $dfj carries two keys and the outer content stays hidden
    // behind its fallback until the slow inner data arrives.
    const groupCalls = [...full.matchAll(/\$dfj\((\[[^\]]*\])\)/g)].map(m => JSON.parse(m[1]));
    expect(groupCalls.length).toBeGreaterThan(0);
    for (const keys of groupCalls) {
      expect(keys, `grouped reveal should only contain the direct slot`).toHaveLength(1);
    }

    // Temporal check: the activation of the outer slot must not be forced to
    // wait for the inner template. The chunk stream should contain the outer
    // template + its activation BEFORE the inner boundary's template chunk.
    const outerKey = groupCalls[0]?.[0];
    const activationIdx = chunks.findIndex(c => c.includes("$dfj"));
    const innerTemplateIdx = chunks.findIndex(
      c => /<template id="(?!pl-)[^"]*"/.test(c) && c.includes("inner-slow")
    );
    expect(activationIdx).toBeGreaterThan(-1);
    expect(innerTemplateIdx).toBeGreaterThan(-1);
    expect(
      activationIdx,
      `outer activation (chunk ${activationIdx}, key ${outerKey}) should stream before the slow inner template (chunk ${innerTemplateIdx})`
    ).toBeLessThan(innerTemplateIdx);
  });

  test("a nested Loading in a direct slot's fallback does not join the ancestor group", async () => {
    function NestedFallback() {
      const slow = createMemo(async () => asyncValue("nested-fallback-ready", 80));
      return <span>{slow()}</span>;
    }
    function First() {
      const value = createMemo(async () => asyncValue("first-ready", 40));
      return <p>{value()}</p>;
    }
    function Second() {
      const value = createMemo(async () => asyncValue("second-ready", 20));
      return <p>{value()}</p>;
    }

    const chunks = await collectChunks(() => (
      <Reveal order="together">
        <Loading
          fallback={
            <Loading fallback={<i>nested fallback pending</i>}>
              <NestedFallback />
            </Loading>
          }
        >
          <First />
        </Loading>
        <Loading fallback={<i>second pending</i>}>
          <Second />
        </Loading>
      </Reveal>
    ));

    const groups = [...chunks.join("").matchAll(/\$dfj\((\[[^\]]*\])\)/g)].map(match =>
      JSON.parse(match[1])
    );
    expect(groups).toHaveLength(1);
    expect(groups[0], "only the two direct slots should join the Reveal group").toHaveLength(2);
  });
});
