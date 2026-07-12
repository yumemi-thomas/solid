import {
  action,
  createErrorBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush
} from "../src/index.js";

afterEach(() => flush());

describe("synchronously-settling thenables", () => {
  it("should resolve a synchronously-resolving thenable immediately", () => {
    const value = createMemo(
      () =>
        ({
          then(onfulfilled?: ((v: number) => any) | null) {
            onfulfilled?.(42);
          }
        }) as PromiseLike<number>
    );

    expect(value()).toBe(42);
  });

  // KNOWN BUG (2.0 audit): a thenable that rejects synchronously is swallowed because the
  // rejection handler is gated on !isSync, so the computation stays pending forever instead
  // of surfacing the error. src/core/async.ts:244-247. Remove .fails when fixed.
  it.fails("should route a synchronously-rejecting thenable to the error boundary", () => {
    const error = new Error("sync-reject");
    let b!: () => any;

    const dispose = createRoot(d => {
      b = createErrorBoundary(
        () => {
          const value = createMemo(
            () =>
              ({
                then(
                  _onfulfilled?: ((v: number) => any) | null,
                  onrejected?: ((e: any) => any) | null
                ) {
                  onrejected?.(error);
                }
              }) as PromiseLike<number>
          );
          return value();
        },
        e => e()
      );
      return d;
    });

    try {
      flush();
      expect(b()).toBe(error);
    } finally {
      dispose();
    }
  });
});

describe("action thenable support", () => {
  // KNOWN BUG (2.0 audit): action() only awaits `instanceof Promise` values, so a yielded
  // PromiseLike (non-Promise) thenable is passed back to the generator as the raw thenable
  // object instead of its settled value. src/core/action.ts:78,86. Remove .fails when fixed.
  it.fails("should await yielded PromiseLike (non-Promise) thenables", async () => {
    let received: any;

    const myAction = action(function* () {
      received = yield {
        then(onfulfilled: (v: number) => void) {
          setTimeout(() => onfulfilled(42), 0);
        }
      };
    });

    myAction();
    await new Promise(r => setTimeout(r, 10));
    flush();

    expect(received).toBe(42);
  });
});

describe("out-of-order async resolution", () => {
  // PIN: when a refetch is triggered and the OLDER promise resolves AFTER the newer
  // one, the newer value must win. Verified clean in the 2.0 audit.
  it("should keep the newer value when an older promise resolves later", async () => {
    const [$id, setId] = createSignal(0);
    const resolvers: Array<(v: string) => void> = [];
    let value!: () => string;

    createRoot(() => {
      value = createMemo(() => {
        $id();
        return new Promise<string>(res => {
          resolvers.push(res);
        });
      });
      createRenderEffect(value, () => {});
    });

    flush();
    expect(resolvers.length).toBe(1);

    // Trigger a refetch while the first promise is still pending
    setId(1);
    flush();
    expect(resolvers.length).toBe(2);

    // The newer promise resolves first
    resolvers[1]("new");
    await new Promise(r => setTimeout(r, 10));
    flush();
    expect(value()).toBe("new");

    // The older promise resolves afterwards - it must not clobber the newer value
    resolvers[0]("old");
    await new Promise(r => setTimeout(r, 10));
    flush();
    expect(value()).toBe("new");
  });
});
