/**
 * @jsxImportSource @solidjs/web
 *
 * Hunt 6 shared scenarios — compiled by BOTH the ssr and dom vitest projects
 * (same pattern as scenarios.tsx). Each scenario probes one suspected
 * server/client hydration-protocol asymmetry.
 */
import { createSignal, createMemo, Errored, Loading, Repeat, NoHydration, Reveal } from "solid-js";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export type Hunt6Scenario = {
  name: string;
  App: () => any;
  expectedText: string;
  /** use renderToString instead of renderToStream on the server side */
  sync?: boolean;
  update?: () => void;
  expectedTextAfterUpdate?: string;
};

// 1. Errored boundary: sync throw during SSR, fallback + trailing dynamic
// sibling (detects both error-state reconstruction and id drift).
let bumpAfterErrored!: () => void;
function ErroredSync() {
  const [n, setN] = createSignal(1);
  bumpAfterErrored = () => setN(2);
  const Boom = () => {
    throw new Error("boom");
  };
  return (
    <div>
      <Errored fallback={err => <i>err:{(err() as Error).message}</i>}>
        <Boom />
      </Errored>
      <span>after {n()}</span>
    </div>
  );
}

// 2. Errored boundary that does NOT error — id-parity control with trailing
// dynamic sibling.
let bumpAfterOk!: () => void;
function ErroredOk() {
  const [n, setN] = createSignal(1);
  bumpAfterOk = () => setN(2);
  return (
    <div>
      <Errored fallback={() => <i>bad</i>}>
        <b>fine</b>
      </Errored>
      <span>after {n()}</span>
    </div>
  );
}

// 3. Repeat rows with per-row element + dynamic hole, trailing sibling.
let bumpAfterRepeat!: () => void;
function RepeatRows() {
  const [n, setN] = createSignal(1);
  bumpAfterRepeat = () => setN(2);
  const [count] = createSignal(3);
  return (
    <div>
      <Repeat count={count()}>{i => <span>r{i}</span>}</Repeat>
      <em>tail {n()}</em>
    </div>
  );
}

// 4. Sync renderToString with pending async: server emits fallback + "$$f",
// client must show fallback then client-render content.
let bumpAfterSyncF!: () => void;
function SyncFallback() {
  const [n, setN] = createSignal(1);
  bumpAfterSyncF = () => setN(2);
  const data = createMemo(async () => {
    await sleep(5);
    return "LATE";
  });
  return (
    <div>
      <Loading fallback={<i>wait</i>}>
        <p>{data()}</p>
      </Loading>
      <span>after {n()}</span>
    </div>
  );
}

// 5. NoHydration zone with static content and trailing dynamic sibling.
let bumpAfterNoHyd!: () => void;
function NoHydZone() {
  const [n, setN] = createSignal(1);
  bumpAfterNoHyd = () => setN(2);
  return (
    <div>
      <NoHydration>
        <b>island</b>
      </NoHydration>
      <span>after {n()}</span>
    </div>
  );
}

// 6. Writable memo (createSignal function form) with serialized async value;
// post-hydration set() must take over.
let setWritable!: (v: string) => void;
function WritableMemo() {
  const [val, setVal] = createSignal(async () => {
    await sleep(5);
    return "SERVERVAL";
  });
  setWritable = setVal as any;
  return (
    <div>
      <Loading fallback={<i>wait</i>}>
        <p>{val()}</p>
      </Loading>
    </div>
  );
}

// 7. Loading with a dynamic (fragment) fallback under streaming — the $df
// comment-terminator bug: swap must not leave fallback debris.
function DynamicFallback() {
  const [pct] = createSignal(42);
  const data = createMemo(async () => {
    await sleep(15);
    return "CONTENT";
  });
  return (
    <div>
      <Loading fallback={<>Loading {pct()}% done</>}>
        <p>{data()}</p>
      </Loading>
    </div>
  );
}

// 8. deferStream memo whose resolved VALUE has `s`/`v` keys of its own. The
// server's deferStream path serializes the RAW value (not a promise wrapper);
// the client's readHydratedValue() sniffs `.s === 2` / `.v` on whatever it
// loads, so user data shaped like { s, v } collides with the protocol.
function DeferShapeCollision() {
  const data = createMemo(
    async () => {
      await sleep(5);
      return { s: 2, v: "payload" };
    },
    { deferStream: true } as any
  );
  return (
    <div>
      <Errored fallback={err => <i>ERR:{String(err())}</i>}>
        <Loading fallback={<i>wait</i>}>
          <p>{data()?.v}</p>
        </Loading>
      </Errored>
    </div>
  );
}

// 8b. Same but value only has a `v` key.
function DeferVOnly() {
  const data = createMemo(
    async () => {
      await sleep(5);
      return { v: "inner" };
    },
    { deferStream: true } as any
  );
  return (
    <div>
      <Loading fallback={<i>wait</i>}>
        <p>{data()?.v}</p>
      </Loading>
    </div>
  );
}

// 9. <Reveal collapsed> under renderToString: the server emits NO markup for
// collapsed tail slots (just serializes "$$f"); the client's "$$f" branch
// renders the fallback during hydration regardless of collapse.
function RevealCollapsedSync() {
  const a = createMemo(async () => {
    await sleep(5);
    return "A";
  });
  const b = createMemo(async () => {
    await sleep(5);
    return "B";
  });
  return (
    <div>
      <Reveal collapsed>
        <Loading fallback={<i>fa</i>}>
          <p>{a()}</p>
        </Loading>
        <Loading fallback={<i>fb</i>}>
          <p>{b()}</p>
        </Loading>
      </Reveal>
    </div>
  );
}

// 10. transparent memo before an element sibling: client transparent memos
// allocate NO hydration id; does the server memo honor `transparent`?
let bumpAfterTransparent!: () => void;
function TransparentMemo() {
  const [n, setN] = createSignal(1);
  bumpAfterTransparent = () => setN(2);
  const m = createMemo(() => "T", { transparent: true } as any);
  return (
    <div>
      <b>{m()}</b>
      <span>after {n()}</span>
    </div>
  );
}

export const scenarios: Hunt6Scenario[] = [
  {
    name: "errored-sync",
    App: ErroredSync,
    expectedText: "err:boomafter 1",
    update: () => bumpAfterErrored(),
    expectedTextAfterUpdate: "err:boomafter 2"
  },
  {
    name: "errored-ok",
    App: ErroredOk,
    expectedText: "fineafter 1",
    update: () => bumpAfterOk(),
    expectedTextAfterUpdate: "fineafter 2"
  },
  {
    name: "repeat-rows",
    App: RepeatRows,
    expectedText: "r0r1r2tail 1",
    update: () => bumpAfterRepeat(),
    expectedTextAfterUpdate: "r0r1r2tail 2"
  },
  {
    name: "sync-fallback",
    App: SyncFallback,
    expectedText: "LATEafter 1",
    sync: true,
    update: () => bumpAfterSyncF(),
    expectedTextAfterUpdate: "LATEafter 2"
  },
  {
    name: "nohydration-zone",
    App: NoHydZone,
    expectedText: "islandafter 1",
    update: () => bumpAfterNoHyd(),
    expectedTextAfterUpdate: "islandafter 2"
  },
  {
    name: "writable-memo",
    App: WritableMemo,
    expectedText: "SERVERVAL",
    update: () => setWritable("CLIENTVAL"),
    expectedTextAfterUpdate: "CLIENTVAL"
  },
  {
    name: "dynamic-fallback",
    App: DynamicFallback,
    expectedText: "CONTENT"
  },
  {
    name: "defer-shape-collision",
    App: DeferShapeCollision,
    expectedText: "payload"
  },
  {
    name: "defer-v-only",
    App: DeferVOnly,
    expectedText: "inner"
  },
  {
    name: "reveal-collapsed-sync",
    App: RevealCollapsedSync,
    expectedText: "AB",
    sync: true
  },
  {
    name: "transparent-memo",
    App: TransparentMemo,
    expectedText: "Tafter 1",
    sync: true,
    update: () => bumpAfterTransparent(),
    expectedTextAfterUpdate: "Tafter 2"
  }
];
