import {
  createEffect,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  flush,
  startGestureTransaction
} from "../src/index.js";

afterEach(() => flush());

describe("startGestureTransaction", () => {
  it("commits normal signal writes by default", () => {
    let dispose!: () => void;
    let value!: () => string;
    let setValue!: (value: string) => string;
    const values: string[] = [];
    createRoot(d => {
      dispose = d;
      const [read, write] = createSignal("before");
      createRenderEffect(read, current => {
        values.push(current);
      });
      value = read;
      setValue = write;
      flush();
    });

    const gesture = startGestureTransaction(() => setValue("after"));

    expect(value()).toBe("after");
    expect(values).toEqual(["before", "after"]);
    gesture.commit();
    flush();
    expect(value()).toBe("after");
    expect(values).toEqual(["before", "after"]);
    dispose();
  });

  it("rolls back normal signal writes on cancel", () => {
    let dispose!: () => void;
    let value!: () => string;
    let setValue!: (value: string) => string;
    const values: string[] = [];
    createRoot(d => {
      dispose = d;
      const [read, write] = createSignal("before");
      createRenderEffect(read, current => {
        values.push(current);
      });
      value = read;
      setValue = write;
      flush();
    });

    const gesture = startGestureTransaction(() => {
      setValue("after");
      setValue("later");
    });

    expect(value()).toBe("later");
    expect(values).toEqual(["before", "later"]);
    gesture.cancel();
    expect(value()).toBe("before");
    expect(values).toEqual(["before", "later", "before"]);
    dispose();
  });

  it("rolls back store writes on cancel", () => {
    let dispose!: () => void;
    let state!: { count: number };
    let setState!: (fn: (state: { count: number }) => void) => void;
    const values: number[] = [];
    createRoot(d => {
      dispose = d;
      const [read, write] = createStore({ count: 0 });
      createRenderEffect(
        () => read.count,
        count => {
          values.push(count);
        }
      );
      state = read;
      setState = write;
      flush();
    });

    const gesture = startGestureTransaction(() => {
      setState(state => {
        state.count = 2;
      });
    });

    expect(state.count).toBe(2);
    expect(values).toEqual([0, 2]);
    gesture.cancel();
    expect(state.count).toBe(0);
    expect(values).toEqual([0, 2, 0]);
    dispose();
  });

  it("defers a user effect during the scope and runs it once on commit", () => {
    let setValue!: (v: number) => number;
    let value!: () => number;
    let dispose!: () => void;
    const runs: number[] = [];
    createRoot(d => {
      dispose = d;
      const [read, write] = createSignal(0);
      value = read;
      setValue = write;
      createEffect(read, v => {
        runs.push(v);
      });
      flush();
    });
    expect(runs).toEqual([0]);

    const gesture = startGestureTransaction(() => setValue(1));
    // The acted-on value is live, but the side-effecting user effect is held.
    expect(value()).toBe(1);
    expect(runs).toEqual([0]);

    gesture.commit();
    expect(runs).toEqual([0, 1]);
    dispose();
  });

  it("drops a user effect's run when the gesture is cancelled", () => {
    let setValue!: (v: number) => number;
    let value!: () => number;
    let dispose!: () => void;
    const runs: number[] = [];
    createRoot(d => {
      dispose = d;
      const [read, write] = createSignal(0);
      value = read;
      setValue = write;
      createEffect(read, v => {
        runs.push(v);
      });
      flush();
    });
    expect(runs).toEqual([0]);

    const gesture = startGestureTransaction(() => setValue(1));
    expect(value()).toBe(1);
    expect(runs).toEqual([0]);

    gesture.cancel();
    flush();
    // Reverted, and the user effect never ran for the gesture or the revert.
    expect(value()).toBe(0);
    expect(runs).toEqual([0]);
    dispose();
  });

  it("defers only gesture-caused effects, not unrelated pending ones", () => {
    let setA!: (v: number) => number;
    let setB!: (v: number) => number;
    let dispose!: () => void;
    const aRuns: number[] = [];
    const bRuns: number[] = [];
    createRoot(d => {
      dispose = d;
      const [a, sa] = createSignal(0);
      const [b, sb] = createSignal(0);
      setA = sa;
      setB = sb;
      createEffect(a, v => {
        aRuns.push(v);
      });
      createEffect(b, v => {
        bRuns.push(v);
      });
      flush();
    });
    expect(aRuns).toEqual([0]);
    expect(bRuns).toEqual([0]);

    // Dirty A's effect (unrelated to the gesture); the gesture writes B.
    setA(1);
    const gesture = startGestureTransaction(() => setB(1));

    // A's effect is not gesture-caused, so it ran; B's effect is deferred.
    expect(aRuns).toEqual([0, 1]);
    expect(bRuns).toEqual([0]);

    gesture.commit();
    expect(bRuns).toEqual([0, 1]);
    dispose();
  });

  it("still runs render effects during the gesture (for the snapshot)", () => {
    let setValue!: (v: number) => number;
    let dispose!: () => void;
    const renders: number[] = [];
    createRoot(d => {
      dispose = d;
      const [read, write] = createSignal(0);
      setValue = write;
      createRenderEffect(read, v => {
        renders.push(v);
      });
      flush();
    });
    expect(renders).toEqual([0]);

    startGestureTransaction(() => setValue(1));
    // Render effects are NOT deferred — the DOM must update for the VT snapshot.
    expect(renders).toEqual([0, 1]);
    dispose();
  });
});
