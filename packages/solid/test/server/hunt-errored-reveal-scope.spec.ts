/** @vitest-environment node */
// Hunt: does a <Loading> wrapped in <Errored> join the ancestor <Reveal> group
// on the server? The client severs the reveal scope in createCollectionBoundary
// for BOTH boundary types, so an Errored-wrapped Loading never registers there.
// Server createErrorBoundary (server/signals.ts) does not sever.
import { describe, expect, test, beforeEach, afterEach } from "vitest";
import { createRoot, createMemo } from "../../src/server/index.js";
import { createErrorBoundary } from "../../src/server/signals.js";
import { Loading, Reveal } from "../../src/server/flow.js";
import { sharedConfig } from "../../src/server/shared.js";

// minimal mock ctx (subset of reveal-ssr.spec.ts harness)
function mockCtx() {
  const registered = new Map<string, any>();
  const context: any = {
    async: true,
    assets: [],
    escape: (s: any) => s,
    resolve: (x: any) => x,
    ssr: (t: string[], ...h: any[]) => ({ t, h, p: [] }),
    serialize() {},
    replace() {},
    block() {},
    registerFragment(key: string, opts?: any) {
      registered.set(key, opts || {});
      return () => true;
    },
    revealFragments() {},
    revealFallbacks() {}
  };
  return { context, registered };
}

describe("hunt: Errored-wrapped Loading vs Reveal group (server)", () => {
  let saved: any;
  beforeEach(() => (saved = sharedConfig.context));
  afterEach(() => (sharedConfig.context = saved));

  // CONFIRMED divergence (see issue-drafts/43-errored-reveal-scope.md): server
  // enrolls the wrapped Loading (2 grouped), client severs (1). test.fails
  // flips when the server ports the severing — if the resolution instead makes
  // the CLIENT stop severing in Errored, delete this file.
  test.fails("Errored-wrapped Loading does not join the group (client parity)", () => {
    const { context, registered } = mockCtx();
    sharedConfig.context = context;
    const never = new Promise(() => {});

    createRoot(
      () => {
        Reveal({
          order: "together",
          get children() {
            return [
              Loading({
                fallback: "direct-fallback",
                get children() {
                  const d = createMemo(() => never);
                  return d() as any; // throws NotReadyError -> boundary pending
                }
              }),
              createErrorBoundary(
                () =>
                  Loading({
                    fallback: "wrapped-fallback",
                    get children() {
                      const d = createMemo(() => never);
                      return d() as any; // throws NotReadyError -> boundary pending
                    }
                  }),
                () => "errored"
              )()
            ] as any;
          }
        } as any);
      },
      { id: "t" }
    );

    const grouped = [...registered.entries()].filter(([, o]) => o.revealGroup);
    console.log("registered:", [...registered.entries()]);
    // Client parity would be 1 (only the direct Loading).
    expect(grouped.length).toBe(1);
  });
});
