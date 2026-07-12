import { createRenderEffect, createRoot, createSignal, flush } from "../src/index.js";

function deferred<T = void>() {
  let resolveFn!: (value: T) => void;
  let rejectFn!: (error?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolveFn = res;
    rejectFn = rej;
  });
  return { promise, resolve: resolveFn, reject: rejectFn };
}

describe("writable async memo: manual set while a fetch is in flight", () => {
  it("manual set with no fetch in flight applies (control)", async () => {
    const d1 = deferred<string>();
    let result: any;
    let setUser!: (v: string) => void;
    createRoot(() => {
      const [user, set] = createSignal<string>(() => d1.promise);
      setUser = set as any;
      createRenderEffect(
        () => (result = user()),
        () => {}
      );
    });
    d1.resolve("server-1");
    for (let i = 0; i < 10; i++) await Promise.resolve();
    flush();
    expect(result).toBe("server-1");

    setUser("manual");
    flush();
    expect(result).toBe("manual");
  });

  it("manual set during the initial fetch must become the visible value", async () => {
    const d1 = deferred<string>();
    let result: any = "(never ran)";
    let setUser!: (v: string) => void;
    createRoot(() => {
      const [user, set] = createSignal<string>(() => d1.promise);
      setUser = set as any;
      createRenderEffect(
        () => {
          try {
            result = user();
          } catch {
            result = "(pending)";
          }
        },
        () => {}
      );
    });
    flush();
    expect(result).toBe("(pending)");

    // The setter is a synchronous write; per the writable-memo contract the
    // manual value wins over the value the in-flight compute would produce.
    setUser("manual");
    flush();
    expect(result).toBe("manual");
  });

  it("manual set during an in-flight refetch must not be silently dropped", async () => {
    const d1 = deferred<string>();
    const d2 = deferred<string>();
    const fetches = [d1.promise, d2.promise];
    let fetchCount = 0;
    let result: any;
    let setUser!: (v: string) => void;
    let setId!: (v: number) => void;

    createRoot(() => {
      const [id, _setId] = createSignal(1);
      setId = _setId as any;
      const [user, set] = createSignal<string>(() => {
        id();
        return fetches[Math.min(fetchCount++, 1)];
      });
      setUser = set as any;
      createRenderEffect(
        () => (result = user()),
        () => {}
      );
    });
    d1.resolve("server-1");
    for (let i = 0; i < 10; i++) await Promise.resolve();
    flush();
    expect(result).toBe("server-1");

    setId(2); // refetch starts, d2 in flight
    flush();
    expect(result).toBe("server-1"); // stale held during revalidation (control)

    setUser("manual"); // manual write supersedes the in-flight compute
    flush();
    expect(result).toBe("manual");

    d2.resolve("server-2"); // the superseded fetch lands
    for (let i = 0; i < 10; i++) await Promise.resolve();
    flush();
    // The manual write happened after the fetch started; it must win.
    expect(result).toBe("manual");
  });
});
