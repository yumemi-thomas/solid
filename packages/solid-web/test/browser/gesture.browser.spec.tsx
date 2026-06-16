/**
 * @jsxImportSource @solidjs/web
 */
// Real-browser (Chromium) gesture tests. These exercise behaviour that the jsdom
// suite cannot: a real `document.startViewTransition`, real pseudo-element
// animations, layout, focus/selection and `:active-view-transition-type()` CSS.
// They lock in the documented mutate-and-revert divergence, the
// captureInteractionState mitigation, and the commit/cancel finalisation fix
// (a committed paused-scrub gesture must not leave a frozen overlay behind).
//
// See packages/solid-web/VIEW_TRANSITIONS.md for the narrative + manual harness.
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createSignal, flush, For, Show } from "solid-js";
import {
  addTransitionType,
  render,
  startGestureTransition,
  UnstableKeepAlive as KeepAlive
} from "@solidjs/web";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
const raf = () => new Promise<void>(r => requestAnimationFrame(() => r()));
const microtasks = async () => {
  for (let i = 0; i < 3; i++) await Promise.resolve();
};

function vtAnimations() {
  return document.documentElement.getAnimations({ subtree: true }).filter(a => {
    const pe = a.effect && (a.effect as KeyframeEffect).pseudoElement;
    return !!pe && pe.includes("::view-transition");
  });
}

async function settle(timeout = 2000) {
  const start = performance.now();
  while (vtAnimations().length > 0 && performance.now() - start < timeout) await raf();
}

// A pointer-style gesture provider that holds the scrub by pausing every
// view-transition pseudo animation and parking it at `frac` (0..1). `currentTime`
// is reported in 0..100 so the runtime's getGestureOffset / shouldCommitGesture
// see a scrub past the midpoint as a commit.
function makeScrubProvider() {
  const tracked = new Set<Animation>();
  let frac = 0;
  const park = (a: Animation) => {
    let dur = 0;
    try {
      const t = a.effect?.getComputedTiming?.();
      if (t && typeof t.duration === "number") dur = t.duration;
    } catch {}
    try {
      a.currentTime = frac * dur;
    } catch {}
  };
  return {
    provider: {
      get currentTime() {
        return frac * 100;
      },
      animate(a: Animation) {
        try {
          a.pause();
        } catch {}
        tracked.add(a);
        park(a);
        return () => tracked.delete(a);
      }
    },
    scrub(f: number) {
      frac = Math.max(0, Math.min(1, f));
      try {
        for (const a of vtAnimations()) {
          if (!tracked.has(a)) {
            try {
              a.pause();
            } catch {}
            tracked.add(a);
          }
          park(a);
        }
      } catch {}
    }
  };
}

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------
let container: HTMLDivElement;
let dispose: (() => void) | undefined;
let injectedStyle: HTMLStyleElement | undefined;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(async () => {
  // Make sure no transition is left mid-flight before the next test starts one.
  for (const a of vtAnimations()) {
    try {
      a.finish();
    } catch {}
  }
  await settle(500);
  dispose?.();
  dispose = undefined;
  container.remove();
  injectedStyle?.remove();
  injectedStyle = undefined;
});

let mountSeq = 0;
function StructPanel(props: { variant: "a" | "b" }) {
  const id = ++mountSeq;
  return (
    <div
      class="struct-panel"
      data-mount={String(id)}
      style={{ "view-transition-name": "vt-struct-panel" }}
    >
      <input class="struct-input" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// the divergence: structural replace
// ---------------------------------------------------------------------------
describe("gesture, real browser: structural replace (the divergence)", () => {
  test("during a scrub the live tree is at the destination, not the current state", async () => {
    const [page, setPage] = createSignal<"a" | "b">("a");
    dispose = render(
      () => (
        <Show when={page()} keyed>
          {p => <StructPanel variant={p} />}
        </Show>
      ),
      container
    );
    await raf();

    const input0 = container.querySelector(".struct-input") as HTMLInputElement;
    const mount0 = (container.querySelector(".struct-panel") as HTMLElement).dataset.mount;
    input0.focus();
    input0.value = "live-state";
    input0.setSelectionRange(4, 4);

    const { provider, scrub } = makeScrubProvider();
    const gesture = startGestureTransition(provider, () => {
      addTransitionType("gesture");
      setPage("b");
      flush();
    });
    await gesture.ready.catch(() => {});
    scrub(0.5);
    await raf();

    const panelNow = container.querySelector(".struct-panel") as HTMLElement;
    const inputNow = container.querySelector(".struct-input") as HTMLInputElement;
    // The live DOM under the scrub is the DESTINATION branch: a brand-new node
    // (React would keep the original here), with none of the original's state.
    expect(panelNow.dataset.mount).not.toBe(mount0);
    expect(inputNow).not.toBe(input0);
    expect(inputNow.value).toBe("");

    gesture.cancelGesture();
    await settle();
  });

  test("cancel recreates the replaced branch as a fresh node (state is lost)", async () => {
    const [page, setPage] = createSignal<"a" | "b">("a");
    dispose = render(
      () => (
        <Show when={page()} keyed>
          {p => <StructPanel variant={p} />}
        </Show>
      ),
      container
    );
    await raf();

    const input0 = container.querySelector(".struct-input") as HTMLInputElement;
    const mount0 = (container.querySelector(".struct-panel") as HTMLElement).dataset.mount;
    input0.focus();
    input0.value = "live-state";

    const { provider, scrub } = makeScrubProvider();
    const gesture = startGestureTransition(provider, () => {
      addTransitionType("gesture");
      setPage("b");
      flush();
    });
    await gesture.ready.catch(() => {});
    scrub(0.5);
    await raf();

    gesture.cancelGesture();
    await settle();
    await microtasks();

    const panelBack = container.querySelector(".struct-panel") as HTMLElement;
    const inputBack = container.querySelector(".struct-input") as HTMLInputElement;
    // Signal rolled back to "a", but the panel came back as a *new* node — the
    // original (and its input value) was disposed while computing the destination
    // and cannot be restored. This is the documented, irreducible casualty.
    expect(page()).toBe("a");
    expect(panelBack.dataset.mount).not.toBe(mount0);
    expect(inputBack).not.toBe(input0);
    expect(inputBack.value).toBe("");
  });
});

// ---------------------------------------------------------------------------
// the boundary: reorder keeps identity + mitigation restores caret
// ---------------------------------------------------------------------------
describe("gesture, real browser: reorder (the unaffected case + mitigation)", () => {
  function Rows(props: { order: () => Array<{ id: string }> }) {
    return (
      <For each={props.order()}>
        {item => (
          <div class="row" style={{ "view-transition-name": `vt-row-${item.id}` }}>
            <input class={`in-${item.id}`} />
          </div>
        )}
      </For>
    );
  }

  test("a moved keyed row keeps node identity and its caret across a cancelled gesture", async () => {
    const seed = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const [order, setOrder] = createSignal(seed);
    dispose = render(() => <Rows order={order} />, container);
    await raf();

    const inA = container.querySelector(".in-a") as HTMLInputElement;
    inA.focus();
    inA.value = "caret-keeps";
    inA.setSelectionRange(3, 3);

    const { provider, scrub } = makeScrubProvider();
    const gesture = startGestureTransition(provider, () => {
      addTransitionType("gesture");
      setOrder(list => [...list].reverse());
      flush();
    });
    await gesture.ready.catch(() => {});
    await microtasks(); // let the runtime's ready.then(restoreInteraction) run
    scrub(0.5);
    await raf();

    // The row moved (now last) but it is the SAME input node, value intact, and
    // the mitigation re-asserted focus + caret on it.
    const inADuring = container.querySelector(".in-a") as HTMLInputElement;
    expect(inADuring).toBe(inA);
    expect(inADuring.value).toBe("caret-keeps");
    expect(document.activeElement).toBe(inA);
    expect(inA.selectionStart).toBe(3);

    gesture.cancelGesture();
    await settle();
    await microtasks();

    const inAAfter = container.querySelector(".in-a") as HTMLInputElement;
    expect(inAAfter).toBe(inA); // identity preserved through the round trip
    expect(inAAfter.value).toBe("caret-keeps");
    expect(document.activeElement).toBe(inA);
    expect(inA.selectionStart).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// finalisation: commit/cancel must not leave a frozen overlay (the fix)
// ---------------------------------------------------------------------------
describe("gesture, real browser: commit/cancel finalisation", () => {
  function startHeldStructuralGesture() {
    const [page, setPage] = createSignal<"a" | "b">("a");
    dispose = render(
      () => (
        <Show when={page()} keyed>
          {p => <StructPanel variant={p} />}
        </Show>
      ),
      container
    );
    const { provider, scrub } = makeScrubProvider();
    const gesture = startGestureTransition(provider, () => {
      addTransitionType("gesture");
      setPage("b");
      flush();
    });
    return { gesture, scrub, page };
  }

  test("commit releases the paused snapshot: no leftover pseudo animations or overlay", async () => {
    const { gesture, scrub, page } = startHeldStructuralGesture();
    await gesture.ready.catch(() => {});
    scrub(0.6);
    await raf();
    // The scrub is genuinely holding the transition open.
    expect(vtAnimations().length).toBeGreaterThan(0);
    expect(vtAnimations().every(a => a.playState === "paused")).toBe(true);

    gesture.commitGesture();
    await settle(2000);

    // Regression guard for the commit-leak fix: a committed paused-scrub gesture
    // must finalise the browser transition, leaving zero pseudo animations and no
    // ::view-transition overlay. Before the fix these persisted indefinitely.
    expect(vtAnimations().length).toBe(0);
    expect(getComputedStyle(document.documentElement, "::view-transition").width).toBe("auto");
    expect(page()).toBe("b"); // committed state kept
  });

  test("cancel releases the paused snapshot too: no leftover pseudo animations", async () => {
    const { gesture, scrub, page } = startHeldStructuralGesture();
    await gesture.ready.catch(() => {});
    scrub(0.4);
    await raf();
    expect(vtAnimations().length).toBeGreaterThan(0);

    gesture.cancelGesture();
    await settle(2000);

    expect(vtAnimations().length).toBe(0);
    expect(getComputedStyle(document.documentElement, "::view-transition").width).toBe("auto");
    expect(page()).toBe("a"); // rolled back
  });
});

// ---------------------------------------------------------------------------
// parity: transition types reach :active-view-transition-type() CSS
// ---------------------------------------------------------------------------
describe("gesture, real browser: transition types reach CSS", () => {
  test(":active-view-transition-type() matches during a live gesture", async () => {
    injectedStyle = document.createElement("style");
    injectedStyle.textContent = `
      .vt-type-probe { color: rgb(0, 0, 0); }
      :root:active-view-transition-type(swipe) .vt-type-probe { color: rgb(7, 8, 9); }
    `;
    document.head.appendChild(injectedStyle);

    const probe = document.createElement("div");
    probe.className = "vt-type-probe";
    container.appendChild(probe);

    const [page, setPage] = createSignal<"a" | "b">("a");
    dispose = render(
      () => (
        <Show when={page()} keyed>
          {p => <StructPanel variant={p} />}
        </Show>
      ),
      container
    );
    await raf();

    // Let the animations run so the transition is active for the selector. (A
    // fully-PAUSED scrub also matches — see the next test; this was previously
    // believed not to, but Chrome matches :active-view-transition-type() while the
    // pseudo animations are paused.)
    const gesture = startGestureTransition({ currentTime: 0 }, () => {
      addTransitionType("swipe");
      setPage("b");
      flush();
    });
    await gesture.ready.catch(() => {});
    await raf();

    expect(getComputedStyle(probe).color).toBe("rgb(7, 8, 9)");

    gesture.commitGesture();
    await settle();
  });

  test(":active-view-transition-type() matches even while the scrub is fully paused", async () => {
    // Corrects a prior note ("a fully-paused scrub does not match"): an isolated
    // Chrome probe showed paused pseudo animations DO keep matching. This locks
    // that in through Solid's real gesture pipeline.
    injectedStyle = document.createElement("style");
    injectedStyle.textContent = `
      .vt-type-probe { color: rgb(0, 0, 0); }
      :root:active-view-transition-type(swipe) .vt-type-probe { color: rgb(7, 8, 9); }
    `;
    document.head.appendChild(injectedStyle);

    const probe = document.createElement("div");
    probe.className = "vt-type-probe";
    container.appendChild(probe);

    const [page, setPage] = createSignal<"a" | "b">("a");
    dispose = render(
      () => (
        <Show when={page()} keyed>
          {p => <StructPanel variant={p} />}
        </Show>
      ),
      container
    );
    await raf();

    const { provider, scrub } = makeScrubProvider();
    const gesture = startGestureTransition(provider, () => {
      addTransitionType("swipe");
      setPage("b");
      flush();
    });
    await gesture.ready.catch(() => {});
    scrub(0.5);
    await raf();

    // Every pseudo animation is paused (held scrub) — and the selector still matches.
    expect(vtAnimations().length).toBeGreaterThan(0);
    expect(vtAnimations().every(a => a.playState === "paused")).toBe(true);
    expect(getComputedStyle(probe).color).toBe("rgb(7, 8, 9)");

    gesture.cancelGesture();
    await settle();
  });
});

// ---------------------------------------------------------------------------
// parity fix: a custom { currentTime, animate } provider must keep the
// transition alive on its own (React adds a paused keep-alive unconditionally;
// Solid previously only did so on the native-AnimationTimeline path, so a custom
// provider that does not itself re-pause every pseudo animation let the
// transition self-finish mid-scrub).
// ---------------------------------------------------------------------------
describe("gesture, real browser: custom-provider keep-alive (parity with React)", () => {
  function renderStruct() {
    const [page, setPage] = createSignal<"a" | "b">("a");
    dispose = render(
      () => (
        <Show when={page()} keyed>
          {p => <StructPanel variant={p} />}
        </Show>
      ),
      container
    );
    return setPage;
  }

  test("a custom provider that drives but does not pause keeps the transition open past the default duration", async () => {
    const setPage = renderStruct();
    await raf();

    // A minimal provider: it reports a scrub offset and receives each animation,
    // but pauses nothing and re-pauses nothing. The runtime must still hold the
    // transition open — exactly React's contract (the runtime keeps it alive; the
    // provider drives). Without the keep-alive the un-paused animations run to
    // their natural ~250ms, finish, and tear the transition down mid-gesture.
    const provider = {
      get currentTime() {
        return 0;
      },
      animate() {
        /* drive nothing, pause nothing */
      }
    };
    const gesture = startGestureTransition(provider, () => {
      addTransitionType("gesture");
      setPage("b");
      flush();
    });
    await gesture.ready.catch(() => {});

    // Wait well past the UA default transition duration (~250ms) without re-driving.
    const start = performance.now();
    while (performance.now() - start < 450) await raf();

    // The transition must still be active: a paused keep-alive holds the overlay
    // open. Before the fix the overlay was gone (width "auto") and there were no
    // pseudo animations left.
    expect(getComputedStyle(document.documentElement, "::view-transition").width).not.toBe("auto");
    expect(vtAnimations().length).toBeGreaterThan(0);

    gesture.cancelGesture();
    await settle();
  });

  test("a custom-provider gesture installs a paused ::view-transition keep-alive", async () => {
    const setPage = renderStruct();
    await raf();

    const { provider, scrub } = makeScrubProvider();
    const gesture = startGestureTransition(provider, () => {
      addTransitionType("gesture");
      setPage("b");
      flush();
    });
    await gesture.ready.catch(() => {});
    scrub(0.5);
    await raf();

    // A blocking animation parked on the root ::view-transition pseudo (duration
    // 1, paused) — the same keep-alive the native-AnimationTimeline path adds.
    const blockers = document.documentElement.getAnimations({ subtree: true }).filter(a => {
      const pe = a.effect && (a.effect as KeyframeEffect).pseudoElement;
      return pe === "::view-transition";
    });
    expect(blockers.length).toBeGreaterThan(0);
    expect(blockers.every(a => a.playState === "paused")).toBe(true);

    gesture.cancelGesture();
    await settle();
  });
});

// ---------------------------------------------------------------------------
// option 1: data-vt-preserve recovers serializable live state on cancel reveal
// for a structurally-replaced branch (focus/scroll alone cannot — the node is
// recreated; an app-provided key matches the recreated content).
// ---------------------------------------------------------------------------
describe("gesture, real browser: data-vt-preserve (serializable state recovery)", () => {
  // Panel A carries opt-in preserved content; panel B is a different branch.
  function PreservePanel(props: { variant: "a" | "b" }) {
    const id = ++mountSeq;
    return (
      <Show when={props.variant === "a"} fallback={<div class="other-panel">B</div>}>
        <div class="preserve-panel" data-mount={String(id)}>
          <input class="p-input" data-vt-preserve="p-input" />
          <div
            class="p-scroll"
            data-vt-preserve="p-scroll"
            style={{ height: "40px", overflow: "auto" }}
          >
            <div style={{ height: "400px" }} />
          </div>
          <details class="p-details" data-vt-preserve="p-details">
            <summary>more</summary>
            body
          </details>
          <video class="p-video" data-vt-preserve="p-video" />
        </div>
      </Show>
    );
  }

  test("cancel restores input value, scroll, details-open and media rate onto the recreated branch", async () => {
    const [page, setPage] = createSignal<"a" | "b">("a");
    dispose = render(
      () => (
        <Show when={page()} keyed>
          {p => <PreservePanel variant={p} />}
        </Show>
      ),
      container
    );
    await raf();

    // User-driven live state on the (uncontrolled) panel-A content.
    const input0 = container.querySelector(".p-input") as HTMLInputElement;
    const scroll0 = container.querySelector(".p-scroll") as HTMLElement;
    const details0 = container.querySelector(".p-details") as HTMLDetailsElement;
    const video0 = container.querySelector(".p-video") as HTMLVideoElement;
    input0.value = "typed-by-user";
    scroll0.scrollTop = 180;
    details0.open = true;
    video0.playbackRate = 2;
    const mount0 = (container.querySelector(".preserve-panel") as HTMLElement).dataset.mount;

    const { provider, scrub } = makeScrubProvider();
    const gesture = startGestureTransition(provider, () => {
      addTransitionType("gesture");
      setPage("b");
      flush();
    });
    await gesture.ready.catch(() => {});
    scrub(0.5);
    await raf();

    gesture.cancelGesture();
    await settle();
    await microtasks();

    const panelBack = container.querySelector(".preserve-panel") as HTMLElement;
    const inputBack = container.querySelector(".p-input") as HTMLInputElement;
    const scrollBack = container.querySelector(".p-scroll") as HTMLElement;
    const detailsBack = container.querySelector(".p-details") as HTMLDetailsElement;
    const videoBack = container.querySelector(".p-video") as HTMLVideoElement;

    // The branch was structurally recreated (fresh node — the documented divergence
    // is unchanged) ...
    expect(page()).toBe("a");
    expect(panelBack.dataset.mount).not.toBe(mount0);
    expect(inputBack).not.toBe(input0);
    // ... but the opt-in serializable state was restored onto the recreated content.
    expect(inputBack.value).toBe("typed-by-user");
    expect(scrollBack.scrollTop).toBe(180);
    expect(detailsBack.open).toBe(true);
    expect(videoBack.playbackRate).toBe(2);
  });

  test("without data-vt-preserve the recreated branch keeps default (empty) state", async () => {
    // Control: the same structural swap on UNMARKED content loses state, as
    // documented. (StructPanel's input has no data-vt-preserve.)
    const [page, setPage] = createSignal<"a" | "b">("a");
    dispose = render(
      () => (
        <Show when={page()} keyed>
          {p => <StructPanel variant={p} />}
        </Show>
      ),
      container
    );
    await raf();
    const input0 = container.querySelector(".struct-input") as HTMLInputElement;
    input0.value = "typed-by-user";

    const { provider, scrub } = makeScrubProvider();
    const gesture = startGestureTransition(provider, () => {
      addTransitionType("gesture");
      setPage("b");
      flush();
    });
    await gesture.ready.catch(() => {});
    scrub(0.5);
    await raf();
    gesture.cancelGesture();
    await settle();
    await microtasks();

    const inputBack = container.querySelector(".struct-input") as HTMLInputElement;
    expect(inputBack.value).toBe("");
  });
});

// ---------------------------------------------------------------------------
// UnstableKeepAlive: deferred-disposal control flow that preserves node IDENTITY
// (and therefore non-serializable state) across a cancelled structural gesture —
// the thing the mutate-and-revert divergence cannot do and data-vt-preserve cannot
// fully cover. Auto-detects the gesture lifecycle (no `active` prop).
// ---------------------------------------------------------------------------
describe("gesture, real browser: UnstableKeepAlive (identity preservation)", () => {
  function startSwap(setPage: (v: "a" | "b") => void) {
    const { provider, scrub } = makeScrubProvider();
    const gesture = startGestureTransition(provider, () => {
      addTransitionType("gesture");
      setPage("b");
      flush();
    });
    return { gesture, scrub };
  }

  test("cancel restores the SAME node and non-serializable JS state", async () => {
    const [page, setPage] = createSignal<"a" | "b">("a");
    dispose = render(
      () => (
        <KeepAlive key={page()}>
          {p => (
            <div class={`ka-panel ka-${p}`} data-mount={String(++mountSeq)}>
              {p === "a" ? <input class="ka-input" /> : <span class="ka-b-label">B</span>}
            </div>
          )}
        </KeepAlive>
      ),
      container
    );
    await raf();

    const panelA0 = container.querySelector(".ka-a") as HTMLElement;
    const inputA0 = container.querySelector(".ka-input") as HTMLInputElement;
    const mountA = panelA0.dataset.mount;
    inputA0.value = "kept-live";
    // Non-serializable live state: a JS object reference held on the node. No
    // serialize/restore (data-vt-preserve) can recover this across a recreate — only
    // identity preservation can.
    const token = { ref: { nested: [1, 2, 3] } };
    (panelA0 as any).__nonSerializable = token;

    const { gesture, scrub } = startSwap(setPage);
    await gesture.ready.catch(() => {});
    scrub(0.5);
    await raf();

    // During the scrub the destination (B) is live; A is detached but RETAINED
    // (not disposed), so its node still exists off-document.
    expect(container.querySelector(".ka-b")).toBeTruthy();
    expect(panelA0.isConnected).toBe(false);

    gesture.cancelGesture();
    await settle();
    await microtasks();

    const panelABack = container.querySelector(".ka-a") as HTMLElement;
    const inputABack = container.querySelector(".ka-input") as HTMLInputElement;
    // Identity preserved across the cancel — the divergence is gone for this path.
    expect(panelABack).toBe(panelA0);
    expect(inputABack).toBe(inputA0);
    expect(panelABack.dataset.mount).toBe(mountA);
    // All state rides along with identity: serializable (the input value) ...
    expect(inputABack.value).toBe("kept-live");
    // ... and non-serializable (the same JS object reference).
    expect((panelABack as any).__nonSerializable).toBe(token);
  });

  test("commit keeps the destination and disposes the retained origin branch", async () => {
    const [page, setPage] = createSignal<"a" | "b">("a");
    dispose = render(
      () => <KeepAlive key={page()}>{p => <div class={`ka-panel ka-${p}`}>{p}</div>}</KeepAlive>,
      container
    );
    await raf();
    const panelA0 = container.querySelector(".ka-a") as HTMLElement;

    const { gesture, scrub } = startSwap(setPage);
    await gesture.ready.catch(() => {});
    scrub(0.5);
    await raf();

    gesture.commitGesture();
    await settle();
    await microtasks();

    // Destination kept; the retained origin branch is disposed (gone from the DOM,
    // not lingering detached).
    expect(page()).toBe("b");
    expect(container.querySelector(".ka-b")).toBeTruthy();
    expect(container.querySelector(".ka-a")).toBeNull();
    expect(panelA0.isConnected).toBe(false);
  });

  test("outside a gesture it behaves like keyed <Show>: no retention, fresh node", async () => {
    const [page, setPage] = createSignal<"a" | "b">("a");
    dispose = render(
      () => (
        <KeepAlive key={page()}>
          {p => <div class={`ka-panel ka-${p}`} data-mount={String(++mountSeq)} />}
        </KeepAlive>
      ),
      container
    );
    await raf();
    const panelA0 = container.querySelector(".ka-a") as HTMLElement;

    // Plain (non-gesture) key changes there-and-back.
    setPage("b");
    await raf();
    setPage("a");
    await raf();

    const panelABack = container.querySelector(".ka-a") as HTMLElement;
    // No gesture was active, so the branch was disposed and rebuilt — a NEW node
    // (identity preservation must not leak into normal navigation).
    expect(panelABack).not.toBe(panelA0);
    expect(panelA0.isConnected).toBe(false);
  });

  test("focus + caret on a kept-alive field survive a cancelled gesture", async () => {
    const [page, setPage] = createSignal<"a" | "b">("a");
    dispose = render(
      () => (
        <KeepAlive key={page()}>
          {p => (p === "a" ? <input class="ka-input" /> : <span class="ka-b-label">B</span>)}
        </KeepAlive>
      ),
      container
    );
    await raf();
    const inputA0 = container.querySelector(".ka-input") as HTMLInputElement;
    inputA0.focus();
    inputA0.value = "caret-here";
    inputA0.setSelectionRange(5, 5);

    const { gesture, scrub } = startSwap(setPage);
    await gesture.ready.catch(() => {});
    scrub(0.5);
    await raf();
    gesture.cancelGesture();
    await settle();
    await microtasks();

    const inputBack = container.querySelector(".ka-input") as HTMLInputElement;
    expect(inputBack).toBe(inputA0); // same node
    expect(inputBack.value).toBe("caret-here");
    expect(document.activeElement).toBe(inputA0);
    expect(inputBack.selectionStart).toBe(5);
  });

  test("cancel preserves the scroll position of a kept-alive container", async () => {
    const [page, setPage] = createSignal<"a" | "b">("a");
    dispose = render(
      () => (
        <KeepAlive key={page()}>
          {p =>
            p === "a" ? (
              <div class="ka-scroll" style={{ height: "40px", overflow: "auto" }}>
                <div style={{ height: "400px" }} />
              </div>
            ) : (
              <span class="ka-b-label">B</span>
            )
          }
        </KeepAlive>
      ),
      container
    );
    await raf();
    const sc0 = container.querySelector(".ka-scroll") as HTMLElement;
    sc0.scrollTop = 160;

    const { provider, scrub } = makeScrubProvider();
    const gesture = startGestureTransition(provider, () => {
      addTransitionType("gesture");
      setPage("b");
      flush();
    });
    await gesture.ready.catch(() => {});
    scrub(0.5);
    await raf();
    gesture.cancelGesture();
    await settle();
    await microtasks();

    const scBack = container.querySelector(".ka-scroll") as HTMLElement;
    // Same node, and scroll restored across the detach/reattach (detach alone resets it).
    expect(scBack).toBe(sc0);
    expect(scBack.scrollTop).toBe(160);
  });

  test("memory bound: scrubbing back-and-forth then settling leaves only the current branch", async () => {
    const [page, setPage] = createSignal<"a" | "b">("a");
    dispose = render(
      () => <KeepAlive key={page()}>{p => <div class={`ka-panel ka-${p}`}>{p}</div>}</KeepAlive>,
      container
    );
    await raf();

    const { provider, scrub } = makeScrubProvider();
    const gesture = startGestureTransition(provider, () => {
      addTransitionType("gesture");
      setPage("b");
      flush();
    });
    await gesture.ready.catch(() => {});
    // Scrub back and forth within the single gesture (both branches get retained).
    scrub(0.5);
    await raf();
    scrub(0);
    await raf();
    scrub(0.6);
    await raf();

    gesture.commitGesture();
    await settle();
    await microtasks();

    // After settle exactly one branch remains in the DOM (the committed one); the
    // retained other is disposed — no unbounded growth.
    expect(container.querySelectorAll(".ka-panel").length).toBe(1);
    expect(container.querySelector(".ka-b")).toBeTruthy();
    expect(container.querySelector(".ka-a")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// graceful degradation: Safari <18 / Firefox <144 (no startViewTransition) and
// Chrome 111–124 (startViewTransition without the {types} options form). The
// gesture transaction (signal commit/rollback) must work regardless, and nothing
// must throw or leak an unhandled rejection.
// ---------------------------------------------------------------------------
describe("gesture, real browser: graceful degradation (cross-browser fallbacks)", () => {
  let originalStart: typeof document.startViewTransition | undefined;

  function renderStructPages() {
    const [page, setPage] = createSignal<"a" | "b">("a");
    dispose = render(
      () => (
        <Show when={page()} keyed>
          {p => <StructPanel variant={p} />}
        </Show>
      ),
      container
    );
    return { page, setPage };
  }

  afterEach(() => {
    // Restore in case a test threw before its own restore.
    if (originalStart !== undefined) {
      (document as any).startViewTransition = originalStart;
      originalStart = undefined;
    }
  });

  test("no startViewTransition (Safari <18 / Firefox <144): gesture applies, commit keeps, cancel rolls back", async () => {
    originalStart = document.startViewTransition;
    (document as any).startViewTransition = undefined;

    // --- commit keeps the destination ---
    {
      const { page, setPage } = renderStructPages();
      await raf();
      const { provider } = makeScrubProvider();
      const gesture = startGestureTransition(provider, () => {
        addTransitionType("gesture");
        setPage("b");
        flush();
      });
      await gesture.ready.catch(() => {});
      // Destination applied synchronously (no real transition to animate).
      expect(page()).toBe("b");
      gesture.commitGesture();
      await microtasks();
      expect(page()).toBe("b");
      dispose?.();
      dispose = undefined;
    }

    // --- cancel rolls the transaction back ---
    {
      const { page, setPage } = renderStructPages();
      await raf();
      const { provider } = makeScrubProvider();
      const gesture = startGestureTransition(provider, () => {
        addTransitionType("gesture");
        setPage("b");
        flush();
      });
      await gesture.ready.catch(() => {});
      expect(page()).toBe("b");
      gesture.cancelGesture();
      await microtasks();
      expect(page()).toBe("a");
    }

    (document as any).startViewTransition = originalStart;
    originalStart = undefined;
    // No leftover pseudo animations from the keep-alive on a non-VT engine.
    await settle(500);
    expect(vtAnimations().length).toBe(0);
  });

  test("startViewTransition without the {types} options form (Chrome 111–124): falls back and still transitions", async () => {
    originalStart = document.startViewTransition;
    // Simulate an engine whose startViewTransition rejects the options object: it
    // only accepts the bare callback form. startBrowserViewTransition must catch and
    // retry with the callback form rather than surface the throw.
    (document as any).startViewTransition = function (arg: unknown) {
      if (arg && typeof arg === "object") throw new TypeError("options form unsupported");
      return (originalStart as any).call(document, arg);
    };

    const { page, setPage } = renderStructPages();
    await raf();
    const { provider, scrub } = makeScrubProvider();
    const gesture = startGestureTransition(provider, () => {
      addTransitionType("gesture");
      setPage("b");
      flush();
    });
    await gesture.ready.catch(() => {});
    scrub(0.5);
    await raf();
    // A real transition still started (via the callback form) and the destination is live.
    expect(page()).toBe("b");

    gesture.commitGesture();
    await settle();
    expect(page()).toBe("b");

    (document as any).startViewTransition = originalStart;
    originalStart = undefined;
  });
});
