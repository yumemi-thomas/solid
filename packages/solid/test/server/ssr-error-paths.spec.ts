/** @vitest-environment node */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createRoot, createMemo } from "../../src/server/index.js";
import { ssrHandleError } from "../../src/server/hydration.js";
import { Loading, Reveal } from "../../src/server/flow.js";
import { sharedConfig } from "../../src/server/shared.js";

// ---- Minimal SSR context infrastructure (mirrors reveal-ssr.spec.ts) ----

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

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface MockSSRContext {
  context: any;
  serialized: Map<string, any>;
  registeredFragments: Map<string, { revealGroup?: string }>;
  fragmentResults: Map<string, string | undefined>;
  fragmentErrors: Map<string, any>;
  revealFragmentsCalls: (string | string[])[];
  revealFallbacksCalls: (string | string[])[];
}

function createMockSSRContext(options: { async?: boolean } = {}): MockSSRContext {
  const serialized = new Map<string, any>();
  const registeredFragments = new Map<string, { revealGroup?: string }>();
  const fragmentResults = new Map<string, string | undefined>();
  const fragmentErrors = new Map<string, any>();
  const revealFragmentsCalls: (string | string[])[] = [];
  const revealFallbacksCalls: (string | string[])[] = [];

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
    registerFragment(key: string, opts?: { revealGroup?: string }) {
      registeredFragments.set(key, opts || {});
      return (value?: string, error?: any) => {
        fragmentResults.set(key, value);
        if (error !== undefined) fragmentErrors.set(key, error);
        return true;
      };
    },
    revealFragments(groupOrKeys: string | string[]) {
      revealFragmentsCalls.push(groupOrKeys);
    },
    revealFallbacks(groupOrKeys: string | string[]) {
      revealFallbacksCalls.push(groupOrKeys);
    }
  };

  return {
    context,
    serialized,
    registeredFragments,
    fragmentResults,
    fragmentErrors,
    revealFragmentsCalls,
    revealFallbacksCalls
  };
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

describe("SSR error paths", () => {
  let savedContext: any;

  beforeEach(() => {
    savedContext = sharedConfig.context;
  });

  afterEach(() => {
    sharedConfig.context = savedContext;
  });

  describe("renderToString with a rejecting async memo", () => {
    // KNOWN BUG (2.0 audit): in a non-async SSR context (renderToString), a rejecting
    // async memo's internal deferred/retry promise is never awaited or serialized, so
    // the rejection escapes as an unhandled promise rejection even though the boundary
    // correctly renders its fallback ($$f). packages/solid/src/server/signals.ts:760-781.
    // Remove .fails when fixed.
    it.fails("renders the $$f fallback without an unhandled promise rejection", async () => {
      // Capture unhandled rejections ourselves. Vitest's own listeners are
      // temporarily detached so the (currently leaking) rejection is observed
      // by this test instead of failing the whole run.
      const priorListeners = process.listeners("unhandledRejection");
      process.removeAllListeners("unhandledRejection");
      const unhandled: unknown[] = [];
      const capture = (reason: unknown) => {
        unhandled.push(reason);
      };
      process.on("unhandledRejection", capture);

      try {
        const mock = createMockSSRContext({ async: false });
        sharedConfig.context = mock.context;

        let result: any;
        createRoot(
          () => {
            result = Loading({
              fallback: "Fallback",
              get children() {
                const data = createMemo(() => Promise.reject(new Error("memo rejected")));
                return ssr(["<div>", "</div>"], () => data()) as any;
              }
            });
          },
          { id: "t" }
        );

        // Sync (renderToString) mode renders the fallback and serializes the
        // "$$f" marker for the boundary…
        expect(read(result)).toBe("Fallback");
        expect([...mock.serialized.values()]).toContain("$$f");

        // …and the rejected async computation must not surface as an
        // unhandled promise rejection.
        await tick();
        await tick();
        expect(unhandled).toEqual([]);
      } finally {
        process.off("unhandledRejection", capture);
        for (const listener of priorListeners) {
          process.on("unhandledRejection", listener as NodeJS.UnhandledRejectionListener);
        }
      }
    });
  });

  describe('errored Loading inside Reveal (order="sequential")', () => {
    /**
     * Two Loading boundaries under <Reveal order="sequential">. Returns the
     * deferreds controlling each boundary plus the mock streaming context.
     */
    function setupSequentialPair() {
      const mock = createMockSSRContext({ async: true });
      sharedConfig.context = mock.context;

      const d1 = deferred<string>();
      const d2 = deferred<string>();

      createRoot(
        () => {
          Reveal({
            order: "sequential",
            get children() {
              return [
                Loading({
                  fallback: "fb-1",
                  get children() {
                    const data = createMemo(() => d1.promise);
                    return ssr(["<div>", "</div>"], () => data()) as any;
                  }
                }),
                Loading({
                  fallback: "fb-2",
                  get children() {
                    const data = createMemo(() => d2.promise);
                    return ssr(["<div>", "</div>"], () => data()) as any;
                  }
                })
              ] as any;
            }
          } as any);
        },
        { id: "t" }
      );

      return { mock, d1, d2 };
    }

    it("a rejected boundary still settles its own fragment (stream does not hang)", async () => {
      const { mock, d1, d2 } = setupSequentialPair();
      expect(mock.registeredFragments.size).toBe(2);
      const keys = [...mock.registeredFragments.keys()];

      d2.resolve("second-value");
      await tick();
      expect(mock.fragmentResults.get(keys[1])).toBe("<div>second-value</div>");

      const error = new Error("first boundary failed");
      d1.reject(error);
      await tick();

      // The errored boundary's done callback fired with the error, so the
      // streamed response can complete.
      expect(mock.fragmentResults.has(keys[0])).toBe(true);
      expect(mock.fragmentResults.get(keys[0])).toBeUndefined();
      expect(mock.fragmentErrors.get(keys[0])).toBe(error);
    });

    // KNOWN BUG (2.0 audit): finalizeError in the server Loading boundary settles the
    // fragment but never calls revealGroup.onResolved, so a rejected boundary inside
    // <Reveal order="sequential"> permanently stalls the frontier and later resolved
    // siblings are never revealed (their revealFragments swap is never emitted).
    // packages/solid/src/server/hydration.ts:125-137 and
    // packages/solid/src/server/flow.ts:414-444. Remove .fails when fixed.
    it.fails("a rejected boundary does not stall reveal of later resolved siblings", async () => {
      const { mock, d1, d2 } = setupSequentialPair();
      const keys = [...mock.registeredFragments.keys()];

      // Second boundary resolves first — sequential order holds its swap
      // behind the (still pending) first boundary.
      d2.resolve("second-value");
      await tick();
      expect(mock.revealFragmentsCalls.length).toBe(0);

      // First boundary errors. Its state is now final (error fallback), so the
      // frontier must advance and reveal the already-resolved second boundary.
      d1.reject(new Error("first boundary failed"));
      await tick();
      await tick();

      const revealed = mock.revealFragmentsCalls.flatMap(c => (Array.isArray(c) ? c : [c]));
      expect(revealed).toContain(keys[1]);
    });
  });
});
