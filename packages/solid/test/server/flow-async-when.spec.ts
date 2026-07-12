/** @vitest-environment node */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createRoot, Show, Switch, Match } from "../../src/server/index.js";
import { ssrHandleError } from "../../src/server/hydration.js";
import { Loading } from "../../src/server/flow.js";
import { sharedConfig } from "../../src/server/shared.js";

// ---- Minimal SSR context infrastructure (mirrors ssr-async.spec.ts) ----

type SSRTemplateObject = { t: string[]; h: Function[]; p: Promise<any>[] };

function resolveSSRNode(
  node: any,
  result: SSRTemplateObject = { t: [""], h: [], p: [] }
): SSRTemplateObject {
  const t = typeof node;
  if (t === "string" || t === "number") {
    result.t[result.t.length - 1] += node;
  } else if (node == null || t === "boolean") {
    // skip
  } else if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      resolveSSRNode(node[i], result);
    }
  } else if (t === "object") {
    if (node.h) {
      result.t[result.t.length - 1] += node.t[0];
      if (node.t.length > 1) {
        result.t.push(...node.t.slice(1));
        result.h.push(...node.h);
        result.p.push(...node.p);
      }
    } else result.t[result.t.length - 1] += node.t;
  } else if (t === "function") {
    try {
      resolveSSRNode(node(), result);
    } catch (err) {
      const p = ssrHandleError(err);
      if (p) {
        result.h.push(node);
        result.p.push(p);
        result.t.push("");
      }
    }
  }
  return result;
}

function resolveSSR(
  template: string[],
  holes: any[],
  result: SSRTemplateObject = { t: [""], h: [], p: [] }
): SSRTemplateObject {
  for (let i = 0; i < holes.length; i++) {
    const hole = holes[i];
    result.t[result.t.length - 1] += template[i];
    if (hole == null || hole === true || hole === false) continue;
    resolveSSRNode(hole, result);
  }
  result.t[result.t.length - 1] += template[template.length - 1];
  return result;
}

function ssr(t: string[], ...nodes: any[]): SSRTemplateObject {
  if (nodes.length) return resolveSSR(t, nodes);
  return { t } as any;
}

function escape(s: any): any {
  if (typeof s !== "string") return s;
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
}

function createMockSSRContext(options: { async?: boolean } = {}) {
  const serialized = new Map<string, any>();
  const registeredFragments = new Set<string>();
  const fragmentResults = new Map<string, string | undefined>();

  const context: any = {
    async: options.async !== false,
    assets: [],
    escape,
    resolve: resolveSSRNode,
    ssr,
    serialize(id: string, p: any) {
      serialized.set(id, p);
    },
    replace() {},
    block() {},
    registerFragment(key: string) {
      registeredFragments.add(key);
      return (value?: string, error?: any) => {
        fragmentResults.set(key, value);
        return true;
      };
    }
  };

  return { context, serialized, registeredFragments, fragmentResults };
}

/** Wait for microtasks and pending async to settle. */
function tick() {
  return new Promise<void>(r => setTimeout(r, 0));
}

const read = (value: any): any => {
  while (typeof value === "function") value = value();
  return value;
};

// ---- Tests ----

describe("Server flow async `when` (Show / Switch / Match)", () => {
  let savedContext: any;

  beforeEach(() => {
    savedContext = sharedConfig.context;
  });

  afterEach(() => {
    sharedConfig.context = savedContext;
  });

  /**
   * Renders `makeChildren` under a Loading boundary with an async streaming SSR
   * context (the renderToStringAsync shape) and returns the final HTML once
   * pending promises have settled: the resolved fragment HTML when the content
   * suspended, or the synchronously rendered output otherwise.
   */
  async function renderAsyncFinalHtml(makeChildren: () => any): Promise<string> {
    const mock = createMockSSRContext();
    sharedConfig.context = mock.context;
    let result: any;

    createRoot(
      () => {
        result = Loading({
          fallback: "PENDING",
          get children() {
            return makeChildren();
          }
        });
      },
      { id: "t" }
    );

    await tick();
    await tick();

    if (mock.fragmentResults.size) return [...mock.fragmentResults.values()].join("");
    const out = read(result);
    if (out && typeof out === "object" && Array.isArray(out.t)) return out.t.join("");
    return String(out ?? "");
  }

  // NOTE: the sync truthy/falsy `when` contract is already pinned in
  // flow.spec.ts ("shows children when truthy" / "shows fallback when falsy"
  // for Show and "renders matching case" for Switch), so it is not duplicated
  // here. This baseline only validates the async render harness itself.
  it("baseline: sync falsy `when` renders the fallback through the async harness", async () => {
    const html = await renderAsyncFinalHtml(
      () =>
        Show({
          when: false,
          fallback: ssr(["<span>fallback-branch</span>"]) as any,
          children: ssr(["<div>children-branch</div>"]) as any
        }) as any
    );
    expect(html).toBe("<span>fallback-branch</span>");
  });

  // KNOWN BUG (2.0 audit): server Show treats a raw Promise `when` as truthy instead
  // of suspending and branching on the resolved value (client semantics), so an async
  // `when` that resolves to false incorrectly renders the children instead of the
  // fallback. packages/solid/src/server/flow.ts:137-152. Remove .fails when fixed.
  it.fails("Show with async `when` resolving to false renders the fallback", async () => {
    const html = await renderAsyncFinalHtml(
      () =>
        Show({
          when: Promise.resolve(false) as any,
          fallback: ssr(["<span>fallback-branch</span>"]) as any,
          children: ssr(["<div>children-branch</div>"]) as any
        }) as any
    );
    expect(html).toContain("fallback-branch");
    expect(html).not.toContain("children-branch");
  });

  // KNOWN BUG (2.0 audit): server Switch/Match treats a raw Promise `when` as truthy,
  // so the first Match with a pending async `when` wins even when that promise resolves
  // to false; the correct output is the second Match whose `when` resolves to true.
  // packages/solid/src/server/flow.ts:166-185. Remove .fails when fixed.
  it.fails("Switch picks the Match whose async `when` resolves truthy", async () => {
    const html = await renderAsyncFinalHtml(
      () =>
        Switch({
          children: [
            Match({
              when: Promise.resolve(false) as any,
              children: ssr(["<div>first-branch</div>"]) as any
            }),
            Match({
              when: Promise.resolve(true) as any,
              children: ssr(["<div>second-branch</div>"]) as any
            })
          ] as any
        }) as any
    );
    expect(html).toContain("second-branch");
    expect(html).not.toContain("first-branch");
  });
});
