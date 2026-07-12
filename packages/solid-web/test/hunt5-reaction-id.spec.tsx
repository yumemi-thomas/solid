/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * HUNT5 protocol audit: createReaction id parity (client half).
 * Server createReaction (packages/solid/src/server/signals.ts:1115) is a pure
 * no-op: `(tracking) => tracking()` — no owner, no child-id slot, ever.
 * Client createReaction (packages/solid-signals/src/signals.ts:566) creates an
 * effect node under the captured owner when `track()` is called — consuming a
 * child-id slot. A component that arms a reaction during render therefore
 * shifts every subsequent sibling hydration id relative to the server.
 */
import { describe, expect, test } from "vitest";
import { createRoot, createReaction, createSignal, getOwner, getNextChildId } from "solid-js";

describe("createReaction id parity (client)", () => {
  test("track() during render must not consume a hydration id slot", () => {
    createRoot(
      () => {
        const [s] = createSignal(0);
        const track = createReaction(() => {});
        track(() => s());
        // Server-side the same sequence leaves the counter at "t0".
        expect(getNextChildId(getOwner()!)).toBe("t0");
      },
      { id: "t" }
    );
  });
});
