/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  createMemo,
  createSignal,
  flush,
  Loading,
  onTransitionInit,
  setCommitGate,
  setTransitionCommitWrapper,
  startTransition
} from "solid-js";
import { addTransitionType, render, ViewTransition } from "../src/index.js";

async function tick(times = 1) {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

// Types seen across all startViewTransition invocations of the current mock.
let seenTypes: string[] = [];

// Robust mock: accept both the callback form `start(update)` and the object
// form `start({ update, types })`, run the update callback (which applies the
// DOM mutation), and resolve the lifecycle promises once it settles.
function mockStartViewTransition() {
  seenTypes = [];
  return vi.fn((arg: any) => {
    const update = typeof arg === "function" ? arg : arg.update;
    if (typeof arg !== "function" && Array.isArray(arg.types)) seenTypes.push(...arg.types);
    const updateCallbackDone = Promise.resolve(update());
    return {
      ready: updateCallbackDone,
      finished: updateCallbackDone,
      updateCallbackDone,
      types: { add() {} },
      skipTransition() {}
    };
  });
}

const original = (document as any).startViewTransition;

// Automatic view transitions are always on — mounting a <ViewTransition> is the
// only opt-in (no enable call). Each test mounts/disposes its own boundary, which
// installs/uninstalls the seam.
afterEach(() => {
  // The seam is normally uninstalled when the boundary unmounts (via dispose()),
  // but a test that throws before its dispose() would leak it into later tests.
  // Force-reset so failures stay isolated.
  setTransitionCommitWrapper(null);
  setCommitGate(null);
  onTransitionInit(null);
  (document as any).startViewTransition = original;
  flush();
});

// Mock whose `finished` is controllable per call (resolvers pushed in order), so
// a transition can be kept "animating" to exercise the commit gate.
let vtFinishResolvers: Array<() => void> = [];
function mockControllableViewTransition() {
  vtFinishResolvers = [];
  return vi.fn((arg: any) => {
    const update = typeof arg === "function" ? arg : arg.update;
    const updateCallbackDone = Promise.resolve(update());
    let resolveFinished!: () => void;
    const finished = new Promise<void>(r => (resolveFinished = r));
    vtFinishResolvers.push(resolveFinished);
    return {
      ready: updateCallbackDone,
      finished,
      updateCallbackDone,
      types: { add() {} },
      skipTransition() {}
    };
  });
}

test("an async commit under a <ViewTransition> auto-wraps in startViewTransition (no manual call)", async () => {
  const root = document.createElement("div");
  const startVT = ((document as any).startViewTransition = mockStartViewTransition());
  const resolvers: Record<string, (value: string) => void> = {};
  let setId!: (value: string) => void;

  const dispose = render(() => {
    const [id, _setId] = createSignal("a");
    setId = _setId;
    const data = createMemo(async () => {
      const current = id();
      return await new Promise<string>(resolve => (resolvers[current] = resolve));
    });
    return (
      <ViewTransition name="auto">
        <Loading fallback="loading" on={id()}>
          {data()}
        </Loading>
      </ViewTransition>
    );
  }, root);

  // Resolve the initial async read to reach steady state.
  flush();
  resolvers.a("data-a");
  await tick(3);
  flush();
  expect(root.textContent).toBe("data-a");

  // Now trigger a *new* async transition with NO manual startViewTransition.
  startVT.mockClear();
  setId("b");
  flush();
  expect(root.textContent).toBe("loading");

  resolvers.b("data-b");
  await tick(3);
  flush();
  await tick(3);

  // The commit(s) of this transition were auto-wrapped by the scheduler seam,
  // with no manual startViewTransition call (a Loading reveal can commit in more
  // than one phase — fallback, then content — so assert "called", not a count).
  expect(startVT).toHaveBeenCalled();
  expect(root.textContent).toBe("data-b");

  dispose();
});

test("an async commit with no <ViewTransition> mounted does not auto-wrap", async () => {
  const root = document.createElement("div");
  const startVT = ((document as any).startViewTransition = mockStartViewTransition());
  const resolvers: Record<string, (value: string) => void> = {};
  let setId!: (value: string) => void;

  // No boundary mounted → the seam is never installed → commits stay fully
  // synchronous, exactly as before. Mounting a <ViewTransition> is the only opt-in.
  const dispose = render(() => {
    const [id, _setId] = createSignal("a");
    setId = _setId;
    const data = createMemo(async () => {
      const current = id();
      return await new Promise<string>(resolve => (resolvers[current] = resolve));
    });
    return (
      <Loading fallback="loading" on={id()}>
        {data()}
      </Loading>
    );
  }, root);

  flush();
  resolvers.a("data-a");
  await tick(3);
  flush();

  startVT.mockClear();
  setId("b");
  flush();
  resolvers.b("data-b");
  await tick(3);
  flush();

  expect(startVT).not.toHaveBeenCalled();
  expect(root.textContent).toBe("data-b");

  dispose();
});

test("addTransitionType declared before an async change survives to the auto-commit", async () => {
  const root = document.createElement("div");
  const startVT = ((document as any).startViewTransition = mockStartViewTransition());
  const resolvers: Record<string, (value: string) => void> = {};
  let setId!: (value: string) => void;

  const dispose = render(() => {
    const [id, _setId] = createSignal("a");
    setId = _setId;
    const data = createMemo(async () => {
      const current = id();
      return await new Promise<string>(resolve => (resolvers[current] = resolve));
    });
    return (
      <ViewTransition name="auto-typed">
        <Loading fallback="loading" on={id()}>
          {data()}
        </Loading>
      </ViewTransition>
    );
  }, root);

  flush();
  resolvers.a("data-a");
  await tick(3);
  flush();

  startVT.mockClear();
  seenTypes = [];

  // Declare the type synchronously, then mutate. The type buffer is normally
  // microtask-cleared before the async commit; the onTransitionInit hook must
  // carry it onto the transition so the commit is typed.
  addTransitionType("report");
  setId("b");
  flush();
  resolvers.b("data-b");
  await tick(3);
  flush();
  await tick(3);

  expect(root.textContent).toBe("data-b");
  expect(seenTypes).toContain("report");

  dispose();
});

test("an async auto-commit surfaces the transition type to the boundary callback (not just the native call)", async () => {
  const root = document.createElement("div");
  (document as any).startViewTransition = mockStartViewTransition();
  // Geometry derived from text length so a content change registers as an update.
  const origGBCR = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const width = (this.textContent ?? "").length * 8;
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: width,
      bottom: 16,
      width,
      height: 16,
      toJSON() {}
    } as DOMRect;
  };

  const updateTypes: string[][] = [];
  let setText!: (value: string) => void;

  const dispose = render(() => {
    const [text, _setText] = createSignal("short");
    setText = _setText;
    return (
      <ViewTransition name="rep" onUpdate={(_inst, types) => updateTypes.push(types)}>
        <span>{text()}</span>
      </ViewTransition>
    );
  }, root);

  flush();

  // An async startTransition: the geometry change commits when the scope settles
  // — one commit, no Loading-fallback fragmentation. The type declared in the
  // scope must reach the callback's `context.types` at that deferred commit; the
  // regression was that it reached only the native startViewTransition call.
  let release!: () => void;
  const gate = new Promise<void>(r => (release = r));
  const p = startTransition(async () => {
    addTransitionType("grow");
    setText("muchlongercontent");
    await gate;
  });
  await tick(2);
  release();
  await p;
  await tick(3);
  flush();

  Element.prototype.getBoundingClientRect = origGBCR;
  expect(updateTypes.flat()).toContain("grow");
  dispose();
});

test("startTransition makes a synchronous change auto-wrap (carrying its type)", async () => {
  const root = document.createElement("div");
  const startVT = ((document as any).startViewTransition = mockStartViewTransition());
  let setLabel!: (v: string) => void;

  const dispose = render(() => {
    const [label, _setLabel] = createSignal("first");
    setLabel = _setLabel;
    return (
      <ViewTransition name="sync-tab">
        <span>{label()}</span>
      </ViewTransition>
    );
  }, root);

  flush();
  expect(root.textContent).toBe("first");

  startVT.mockClear();
  seenTypes = [];

  // A purely synchronous change — not an async transition. startTransition makes
  // it commit as a transition, so the auto seam wraps it in a view transition.
  startTransition(() => {
    addTransitionType("nav");
    setLabel("second");
  });
  await tick(3);

  expect(startVT).toHaveBeenCalled();
  expect(seenTypes).toContain("nav");
  expect(root.textContent).toBe("second");

  dispose();
});

test("startTransition with an async scope holds the commit until it settles (keeping its type)", async () => {
  const root = document.createElement("div");
  const startVT = ((document as any).startViewTransition = mockStartViewTransition());
  let setLabel!: (v: string) => void;

  const dispose = render(() => {
    const [label, _setLabel] = createSignal("first");
    setLabel = _setLabel;
    return (
      <ViewTransition name="async-scope">
        <span>{label()}</span>
      </ViewTransition>
    );
  }, root);

  flush();
  expect(root.textContent).toBe("first");

  startVT.mockClear();
  seenTypes = [];

  let release!: () => void;
  const gate = new Promise<void>(r => (release = r));
  const p = startTransition(async () => {
    addTransitionType("nav");
    setLabel("second");
    await gate;
  });

  // Held open while the scope is pending: old value still showing, no VT yet.
  await tick(2);
  expect(root.textContent).toBe("first");
  expect(startVT).not.toHaveBeenCalled();

  // Settle the scope → the held transition commits, auto-wrapped and typed.
  release();
  await p;
  await tick(3);

  expect(startVT).toHaveBeenCalled();
  expect(seenTypes).toContain("nav");
  expect(root.textContent).toBe("second");

  dispose();
});

test("a second auto-transition waits for the first to finish, then commits the latest (no abort)", async () => {
  const root = document.createElement("div");
  const startVT = ((document as any).startViewTransition = mockControllableViewTransition());
  let setLabel!: (v: string) => void;

  const dispose = render(() => {
    const [label, _setLabel] = createSignal("a");
    setLabel = _setLabel;
    return (
      <ViewTransition name="rapid">
        <span>{label()}</span>
      </ViewTransition>
    );
  }, root);

  flush();
  startVT.mockClear();
  vtFinishResolvers = [];

  // First transition: auto-wraps and starts animating (its `finished` is pending).
  startTransition(() => setLabel("b"));
  await tick(2);
  expect(startVT).toHaveBeenCalledTimes(1);
  expect(root.textContent).toBe("b");

  // Two more rapid transitions WHILE the first is still animating. The gate must
  // defer them — NOT start a second startViewTransition that aborts the first —
  // and they must coalesce so the latest wins.
  startTransition(() => setLabel("c"));
  startTransition(() => setLabel("d"));
  await tick(2);
  expect(startVT).toHaveBeenCalledTimes(1); // still deferred, first not aborted
  expect(root.textContent).toBe("b"); // old value held on screen

  // Finish the first animation → the deferred commit fires ONE more transition,
  // to the coalesced latest ("d", not "c").
  vtFinishResolvers[0]();
  await tick(4);
  flush();
  await tick(2);

  expect(startVT).toHaveBeenCalledTimes(2);
  expect(root.textContent).toBe("d");

  // Drain any still-pending `finished` so the gate's active-promise ref clears
  // and doesn't leak into the next test.
  vtFinishResolvers.forEach(r => r());
  await tick(2);
  dispose();
});

test("a synchronous update during an active transition is not deferred (commits immediately)", async () => {
  const root = document.createElement("div");
  const startVT = ((document as any).startViewTransition = mockControllableViewTransition());
  let setLabel!: (v: string) => void;

  const dispose = render(() => {
    const [label, _setLabel] = createSignal("a");
    setLabel = _setLabel;
    return (
      <ViewTransition name="sync-during">
        <span>{label()}</span>
      </ViewTransition>
    );
  }, root);

  flush();
  startVT.mockClear();
  vtFinishResolvers = [];

  // Start an auto transition (animating, finished pending).
  startTransition(() => setLabel("b"));
  await tick(2);
  expect(startVT).toHaveBeenCalledTimes(1);

  // A plain SYNC update while the transition animates: React parity says sync
  // updates are not view-transition-eligible — they commit immediately (cutting
  // the animation), not gated. So the DOM updates now and no new VT is started.
  setLabel("c");
  flush();
  expect(root.textContent).toBe("c");
  expect(startVT).toHaveBeenCalledTimes(1); // no extra VT for the sync change

  vtFinishResolvers.forEach(r => r());
  await tick(2);
  dispose();
});

test("a type declared with no following transition does not leak into a later one", async () => {
  const root = document.createElement("div");
  const startVT = ((document as any).startViewTransition = mockStartViewTransition());
  const resolvers: Record<string, (value: string) => void> = {};
  let setId!: (value: string) => void;

  const dispose = render(() => {
    const [id, _setId] = createSignal("a");
    setId = _setId;
    const data = createMemo(async () => {
      const current = id();
      return await new Promise<string>(resolve => (resolvers[current] = resolve));
    });
    return (
      <ViewTransition name="auto-leak">
        <Loading fallback="loading" on={id()}>
          {data()}
        </Loading>
      </ViewTransition>
    );
  }, root);

  flush();
  resolvers.a("data-a");
  await tick(3);
  flush();

  // Declare a type but cause NO transition, then let the buffer's deferred
  // (macrotask) clear fire.
  addTransitionType("stale");
  await new Promise(resolve => setTimeout(resolve));

  // A later, unrelated async transition with no type of its own must not inherit
  // the stale type.
  startVT.mockClear();
  seenTypes = [];
  setId("b");
  flush();
  resolvers.b("data-b");
  await tick(3);
  flush();
  await tick(3);

  expect(root.textContent).toBe("data-b");
  expect(seenTypes).not.toContain("stale");

  dispose();
});
