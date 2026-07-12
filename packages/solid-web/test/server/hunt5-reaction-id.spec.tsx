/**
 * @jsxImportSource @solidjs/web
 *
 * HUNT5 protocol audit: createReaction id parity (server half).
 * See test/hunt5-reaction-id.spec.tsx for the client half — client consumes a
 * child-id slot at track() time, server consumes none.
 */
import { describe, expect, test } from "vitest";
import { createRoot, createReaction, createSignal, getOwner } from "solid-js";
import { getNextChildId } from "solid-js";

describe("createReaction id parity (server)", () => {
  test("track() during render does not consume a hydration id slot", () => {
    createRoot(
      () => {
        const [s] = createSignal(0);
        const track = createReaction(() => {});
        track(() => s());
        expect(getNextChildId(getOwner()!)).toBe("t0");
      },
      { id: "t" }
    );
  });
});
