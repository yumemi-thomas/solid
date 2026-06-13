import { createReaction, createRoot, createSignal, flush } from "../src/index.js";

describe("createReaction", () => {
  test("Create and trigger a Reaction", () => {
    let count = 0;
    const [sign, setSign] = createSignal("thoughts");
    const track = createRoot(() =>
      createReaction(() => {
        count++;
      })
    );
    flush();
    expect(count).toBe(0);
    track(sign);
    expect(count).toBe(0);
    flush();
    expect(count).toBe(0);
    setSign("mind");
    flush();
    expect(count).toBe(1);
    setSign("body");
    flush();
    expect(count).toBe(1);
    track(sign);
    setSign("everything");
    flush();
    expect(count).toBe(2);
  });

  test("fires and disposes cleanly when the rerun tracks zero dependencies", () => {
    let fired = 0;
    let readDep = true;
    const [sign, setSign] = createSignal("a");
    createRoot(() => {
      const track = createReaction(() => {
        fired++;
      });
      track(() => {
        // initial run reads a dep; the invalidating rerun reads none
        if (readDep) sign();
      });
    });
    flush();
    expect(fired).toBe(0);

    readDep = false;
    setSign("b");
    expect(() => flush()).not.toThrow();
    expect(fired).toBe(1);
  });

  test("throws on invalid cleanup values", () => {
    const [sign, setSign] = createSignal("thoughts");
    const track = createRoot(() =>
      createReaction(() => {
        return 123 as any;
      })
    );

    track(sign);
    setSign("mind");
    expect(() => flush()).toThrow(
      "Reaction callback returned an invalid cleanup value. Return a cleanup function or undefined."
    );
  });
});
