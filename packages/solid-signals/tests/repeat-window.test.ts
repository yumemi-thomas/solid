import { createRoot, createSignal, flush, onCleanup, repeat } from "../src/index.js";

afterEach(() => flush());

describe("disjoint window jumps", () => {
  function windowed() {
    const [from, setFrom] = createSignal(0);
    const mapped: number[] = [];
    let cleaned = 0;
    let view!: () => number[];
    createRoot(() => {
      view = repeat(
        () => 3,
        i => {
          mapped.push(i);
          onCleanup(() => cleaned++);
          return i;
        },
        { from }
      );
    });
    flush();
    return {
      mapped,
      view,
      jump: (n: number) => {
        setFrom(n);
        flush();
      },
      live: () => mapped.length - cleaned
    };
  }

  it("a forward jump larger than the window creates only the window's rows", () => {
    const w = windowed();
    expect(w.view()).toEqual([0, 1, 2]);
    expect(w.live()).toBe(3);
    w.jump(10);
    expect(w.view()).toEqual([10, 11, 12]);
    expect(w.mapped).toEqual([0, 1, 2, 10, 11, 12]);
    expect(w.live()).toBe(3);
  });

  it("repeated disjoint jumps do not accumulate live scopes", () => {
    const w = windowed();
    w.jump(10);
    w.jump(20);
    expect(w.view()).toEqual([20, 21, 22]);
    expect(w.live()).toBe(3);
  });

  it("a backward disjoint jump maps the new window without crashing", () => {
    const w = windowed();
    w.jump(20);
    expect(() => w.jump(0)).not.toThrow();
    expect(w.view()).toEqual([0, 1, 2]);
    expect(w.live()).toBe(3);
  });

  it("initial render with a nonzero `from` maps only the window", () => {
    const [from] = createSignal(10);
    let created = 0;
    let view!: () => number[];
    createRoot(() => {
      view = repeat(
        () => 3,
        i => {
          created++;
          return i;
        },
        { from }
      );
    });
    flush();
    expect(view()).toEqual([10, 11, 12]);
    expect(created).toBe(3);
  });
});
