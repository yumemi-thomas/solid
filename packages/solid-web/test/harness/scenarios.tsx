/**
 * @jsxImportSource @solidjs/web
 *
 * Shared hydration-parity scenarios (#2801).
 *
 * This file is imported by BOTH vitest projects:
 *   - test/server/hydration-harness.spec.tsx  (ssr generate)   — renders each
 *     scenario with renderToStream and writes chunk artifacts to
 *     test/harness/__artifacts__/.
 *   - test/hydration/parity-harness.spec.tsx  (dom generate)   — replays the
 *     artifact chunks into jsdom and hydrates the identically-sourced
 *     component, asserting generic invariants (no hydration warnings, no
 *     client-created nodes, node identity, post-hydration update pass).
 *
 * Because the two projects compile this same source with their respective
 * generates, the harness verifies actual compiler output on both sides —
 * there are no hand-maintained mirrors that could drift.
 *
 * Scenario rules:
 * - Components rebind their update handles (module-level `let`) on every
 *   instantiation, so the hydrate spec can drive post-hydration updates.
 * - Keep async delays short (5-15ms) — the specs own the settle waits.
 */
import { createSignal, createMemo, Show, For, Loading } from "solid-js";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export type Scenario = {
  name: string;
  App: () => any;
  /** textContent of the container once hydration fully settles */
  expectedText: string;
  /** client-side update trigger (rebound on every App instantiation) */
  update?: () => void;
  expectedTextAfterUpdate?: string;
  /**
   * CSS selector for elements that sit outside the updated hole and therefore
   * must keep DOM identity across the update pass (recreation = insert
   * bookkeeping drift, #2801 bug 1).
   */
  stableSelector?: string;
  /**
   * scenario involves async/streaming — the hydrate spec replays it in two
   * modes: "loaded" (all chunks applied before hydrate — the full-page
   * refresh case, boundary state settled) and "streamed" (shell, hydrate,
   * then late chunks — live streaming with $df swaps).
   */
  async?: boolean;
  /** known-broken on main; hydrate spec wraps in test.fails */
  knownFailure?: string;
  /** known-broken only in the streamed replay mode */
  knownFailureStreamed?: string;
};

// ---------------------------------------------------------------------------
// 1. Text hole between static text (allocates no ids)
let setCount!: (v: number) => void;
function TextHole() {
  const [count, set] = createSignal(5);
  setCount = set;
  return <div>Count: {count()} end</div>;
}

// ---------------------------------------------------------------------------
// 2. Ternary element child before a static sibling (condition memo, statement form)
let setTern!: (v: boolean) => void;
function TernaryChild() {
  const [on, set] = createSignal(true);
  setTern = set;
  return (
    <div>
      {on() ? <b>yes</b> : <i>no</i>}
      <span>sib</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. Logical && element child before a static sibling
let setShown!: (v: boolean) => void;
function LogicalAnd() {
  const [shown, set] = createSignal(true);
  setShown = set;
  return (
    <div>
      {shown() && <h4>title</h4>}
      <span>after</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4. Nested ternary (inline condition memos in branches)
let setNestedA!: (v: boolean) => void;
function NestedTernary() {
  const [a, setA] = createSignal(true);
  const [b] = createSignal(true);
  setNestedA = setA;
  return (
    <div>
      {a() ? b() ? <b>ab</b> : <i>a-only</i> : <u>none</u>}
      <span>tail</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 5. Top-level fragment with a dynamic entry (memo hole on both sides)
let setMid!: (v: string) => void;
function FragmentEntries() {
  const [mid, set] = createSignal("mid");
  setMid = set;
  return (
    <>
      <div>first</div>
      {mid()}
      <div>last</div>
    </>
  );
}

// ---------------------------------------------------------------------------
// 6. Component children hole before a component sibling (props.children)
function CCParent(props: { children: any }) {
  return (
    <section>
      {props.children}
      <CCSibling />
    </section>
  );
}
function CCChild() {
  return <span>child</span>;
}
function CCSibling() {
  return <span>sibling</span>;
}
function ComponentChildren() {
  return (
    <CCParent>
      <CCChild />
    </CCParent>
  );
}

// ---------------------------------------------------------------------------
// 7. Show flow control with fallback
let setVisible!: (v: boolean) => void;
function ShowFlow() {
  const [visible, set] = createSignal(true);
  setVisible = set;
  return (
    <div>
      <Show when={visible()} fallback={<p>hidden</p>}>
        <p>shown</p>
      </Show>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 8. For list with post-hydration append
let setItems!: (v: string[]) => void;
function ForList() {
  const [items, set] = createSignal(["a", "b", "c"]);
  setItems = set;
  return (
    <ul>
      <For each={items()}>{item => <li>{item}</li>}</For>
    </ul>
  );
}

// ---------------------------------------------------------------------------
// 9. Spread with children in the spread object
function SpreadChildren() {
  const props = { class: "sp", children: <em>spread</em> };
  return <div {...props} />;
}

// ---------------------------------------------------------------------------
// 10. Async memo under Loading, element-wrapped content (settled by shell)
let refreshAsyncDiv!: () => void;
function AsyncSettledDiv() {
  const [version, setVersion] = createSignal(0);
  refreshAsyncDiv = () => setVersion(v => v + 1);
  const data = createMemo(async () => {
    const v = version();
    await sleep(5);
    return 42 + v;
  });
  return (
    <Loading fallback={<p>loading</p>}>
      <div>Value: {data()}</div>
    </Loading>
  );
}

// ---------------------------------------------------------------------------
// 11. Async memo at fragment root beside loose text (#2801 bug 1, settled case)
let refreshAsyncFrag!: () => void;
function AsyncSettledFragment() {
  const [version, setVersion] = createSignal(0);
  refreshAsyncFrag = () => setVersion(v => v + 1);
  const data = createMemo(async () => {
    const v = version();
    await sleep(5);
    return 42 + v;
  });
  return (
    <Loading fallback={<p>loading</p>}>
      Count: {data()} <span>after</span>
    </Loading>
  );
}

// ---------------------------------------------------------------------------
// 12. Deferred id-allocating hole before eager id-allocating siblings
// (#2801 bug 2 shape): the async hole defers on the server and retries after
// the eager conditional already advanced the shared parent id counter, so its
// content renders with different _hk than the client allocates in source order.
let refreshBug2!: () => void;
function DeferredBeforeSiblings() {
  const [version, setVersion] = createSignal(0);
  refreshBug2 = () => setVersion(v => v + 1);
  const data = createMemo(async () => {
    version();
    await sleep(10);
    return ["x", "y"];
  });
  const [cond] = createSignal(true);
  return (
    <Loading fallback={<p>loading</p>}>
      <div>
        {data() ? <strong>{data().length}</strong> : <em>none</em>}
        {cond() && <h4>Title</h4>}
        <span>tail</span>
      </div>
    </Loading>
  );
}

export const scenarios: Scenario[] = [
  {
    name: "text-hole",
    App: TextHole,
    expectedText: "Count: 5 end",
    update: () => setCount(6),
    expectedTextAfterUpdate: "Count: 6 end",
    stableSelector: "div"
  },
  {
    name: "ternary-element-child",
    App: TernaryChild,
    expectedText: "yessib",
    update: () => setTern(false),
    expectedTextAfterUpdate: "nosib",
    stableSelector: "div, span"
  },
  {
    name: "logical-and-before-sibling",
    App: LogicalAnd,
    expectedText: "titleafter",
    update: () => setShown(false),
    expectedTextAfterUpdate: "after",
    stableSelector: "div, span"
  },
  {
    name: "nested-ternary",
    App: NestedTernary,
    expectedText: "abtail",
    update: () => setNestedA(false),
    expectedTextAfterUpdate: "nonetail",
    stableSelector: "div, span"
  },
  {
    name: "fragment-dynamic-entry",
    App: FragmentEntries,
    expectedText: "firstmidlast",
    update: () => setMid("MID"),
    expectedTextAfterUpdate: "firstMIDlast",
    stableSelector: "div"
  },
  {
    name: "component-children-before-sibling",
    App: ComponentChildren,
    expectedText: "childsibling"
  },
  {
    name: "show-flow",
    App: ShowFlow,
    expectedText: "shown",
    update: () => setVisible(false),
    expectedTextAfterUpdate: "hidden",
    stableSelector: "div"
  },
  {
    name: "for-list",
    App: ForList,
    expectedText: "abc",
    update: () => setItems(["a", "b", "c", "d"]),
    expectedTextAfterUpdate: "abcd",
    stableSelector: "ul"
  },
  {
    name: "spread-children",
    App: SpreadChildren,
    expectedText: "spread"
  },
  {
    name: "async-settled-element",
    App: AsyncSettledDiv,
    async: true,
    expectedText: "Value: 42",
    update: () => refreshAsyncDiv(),
    expectedTextAfterUpdate: "Value: 43",
    stableSelector: "div"
  },
  {
    name: "async-settled-fragment-root",
    App: AsyncSettledFragment,
    async: true,
    expectedText: "Count: 42 after",
    update: () => refreshAsyncFrag(),
    expectedTextAfterUpdate: "Count: 43 after",
    stableSelector: "span",
    knownFailureStreamed:
      "#2801 bug 1 pending-stream case: loose text at fragment root cannot re-claim after the $df swap (keyed text re-claim follow-up)"
  },
  {
    name: "deferred-hole-before-siblings",
    App: DeferredBeforeSiblings,
    async: true,
    expectedText: "2Titletail",
    update: () => refreshBug2(),
    expectedTextAfterUpdate: "2Titletail",
    stableSelector: "span",
    knownFailure:
      "#2801 bug 2: deferred hole retries after eager siblings advanced the parent id counter — server/client _hk mismatch until hole owners land"
  }
];
