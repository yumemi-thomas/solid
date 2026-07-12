import { createReaction, createRoot, createSignal, flush } from "../src/index.js";

afterEach(() => flush());

describe("createReaction edge cases", () => {
  // KNOWN BUG (2.0 audit): createReaction crashes when the tracking function reads zero
  // dependencies on its rerun. dispose() at src/core/owner.ts:38-46 uses a do-while over
  // `_deps`, so a null `_deps` reaches unlinkSubs(null) and throws a TypeError during
  // flush. Fixed (commit db88de1f).
  it("does not crash when the rerun tracking function has zero dependencies", () => {
    let fired = 0;
    const [count, setCount] = createSignal(0);
    const track = createRoot(() =>
      createReaction(() => {
        fired++;
      })
    );

    let done = false;
    track(() => {
      if (!done) count();
    });
    flush();
    expect(fired).toBe(0);

    // On invalidation the tracking function reruns and now reads nothing.
    done = true;
    setCount(1);
    expect(() => flush()).not.toThrow();
    expect(fired).toBe(1);
  });
});
