import {
  addTransitionType,
  startGestureTransition,
  UnstableKeepAlive as KeepAlive
} from "@solidjs/web";
import { createSignal, flush, For, onCleanup, Show } from "solid-js";
import { chip, desc, kicker, Panel, primaryBtn } from "../ui";

// Each mount gets a unique id, so a rebuilt branch is observable: a fresh mount #
// means a brand-new component instance (state lost); the same # means the very
// same live instance was retained.
let mountSeq = 0;

// A screen full of state that CANNOT be snapshot-and-restored: a stopwatch driven
// by a live `setInterval` (its effect keeps running — KeepAlive does not pause it,
// unlike Activity), the caret/text in an input, and a scroll position.
function LiveSession(props: { seedRef: (el: HTMLInputElement) => void }) {
  const mountId = ++mountSeq;
  const [ticks, setTicks] = createSignal(0);
  const id = setInterval(() => setTicks(t => t + 1), 100);
  onCleanup(() => clearInterval(id));
  const rows = Array.from({ length: 16 }, (_, i) => i + 1);
  return (
    <div class="grid gap-3 rounded-[10px] border border-line bg-white p-[14px] shadow-[0_1px_2px_rgba(15,29,51,0.04)]">
      <div class="flex items-center justify-between">
        <strong class="text-ink">Live session</strong>
        <span class="ka-mount rounded-full bg-[rgba(79,136,198,0.14)] px-2 py-0.5 font-mono text-[0.72rem] text-solid">
          mount #{mountId}
        </span>
      </div>
      <div class="flex items-baseline gap-2">
        <span class="ka-ticks font-display text-[2.2rem] font-extrabold leading-none tabular-nums text-solid-ink">
          {(ticks() / 10).toFixed(1)}
        </span>
        <span class="text-[0.8rem] text-muted">seconds — the timer is running</span>
      </div>
      <label class="grid gap-1 text-[0.78rem] text-muted">
        <span>Half-typed note (text + caret)</span>
        <input
          ref={props.seedRef}
          type="text"
          class="ka-draft box-border w-full rounded-md border border-line-strong bg-[#f8fbfe] p-2 text-[0.9rem] text-ink"
        />
      </label>
      <div class="h-[92px] overflow-y-auto rounded-md border border-line bg-[#f8fbfe] [scrollbar-color:rgba(15,29,51,0.2)_transparent] [scrollbar-width:thin]">
        <For each={rows}>
          {i => (
            <div class="border-b border-line px-3 py-1.5 text-[0.8rem] text-ink">
              Row {i} — scroll me, then run
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

function InboxScreen() {
  return (
    <div class="rounded-[10px] border border-line bg-[#eef4fb] p-[14px] text-ink">
      <strong>Inbox</strong>
      <p class="mt-1.5 text-[0.9rem] text-muted">3 conversations (the previous screen)</p>
    </div>
  );
}

const SAMPLE = "draft I don't want to lose…";

export function GestureScrubDemo() {
  const [page, setPage] = createSignal<"live" | "inbox">("live");
  const [running, setRunning] = createSignal(false);
  const [ran, setRan] = createSignal(false);

  // Seed each side's note once, imperatively — so a rebuilt Live session comes
  // back EMPTY while a kept-alive one still holds it.
  let leftSeeded = false;
  let rightSeeded = false;
  const seedLeft = (el: HTMLInputElement) => {
    if (!leftSeeded) {
      el.value = SAMPLE;
      leftSeeded = true;
    }
  };
  const seedRight = (el: HTMLInputElement) => {
    if (!rightSeeded) {
      el.value = SAMPLE;
      rightSeeded = true;
    }
  };

  const run = () => {
    if (running()) return;
    setRunning(true);
    setRan(false);
    // The gesture holds the transition open: KeepAlive retains the outgoing Live
    // session while a gesture is in flight, so cancelling reattaches the exact
    // same nodes. The button drives the whole swipe so you never interact under
    // the frozen snapshot.
    const gesture = startGestureTransition({ currentTime: 0 }, () => {
      addTransitionType("gesture");
      addTransitionType("back");
      setPage("inbox");
      flush();
    });
    // Swipe toward the Inbox for a beat, then change our mind and cancel back.
    setTimeout(() => {
      gesture.cancelGesture();
      setRunning(false);
      setRan(true);
    }, 600);
  };

  const reset = () => {
    if (running()) return;
    leftSeeded = false;
    rightSeeded = false;
    setRan(false);
    // No gesture here, so both sides rebuild fresh — the baseline to compare against.
    setPage("inbox");
    queueMicrotask(() => setPage("live"));
  };

  return (
    <div class="grid gap-4">
      <Panel>
        <span class={kicker}>UnstableKeepAlive</span>
        <h2>The same live instance survives a swipe-back</h2>
        <p class={desc}>
          You start to swipe back to the Inbox, then cancel. A keyed <code>&lt;Show&gt;</code>{" "}
          rebuilds the screen from scratch; <code>KeepAlive</code> retains the very same instance
          while the gesture is in flight, so cancelling restores it exactly — including a{" "}
          <strong>running timer</strong> (its effect never paused), the caret, and scroll. Press Run
          and watch the stopwatch.
        </p>
        <div class="flex items-center gap-2.5">
          <button type="button" class={primaryBtn} onClick={run} disabled={running()}>
            {running() ? "swiping back…" : "Run: swipe back, then cancel"}
          </button>
          <button type="button" class={chip()} onClick={reset} disabled={running()}>
            Reset
          </button>
        </div>
        <Show when={ran() && !running()}>
          <p class={desc}>
            Cancelled. <strong>Left</strong> was rebuilt: new mount #, stopwatch back near 0, note
            and scroll gone. <strong>Right</strong> is the same kept-alive instance — same mount #,
            the timer never stopped, note and scroll intact.
          </p>
        </Show>
      </Panel>

      <section class="flex items-start gap-4 rounded-lg border border-line bg-white/70 p-[22px] max-[860px]:flex-col">
        <div class="flex-1">
          <header class="mb-2 flex items-center gap-2 text-[0.9rem] font-semibold">
            Default: keyed &lt;Show&gt;
            <span class="text-[0.72rem] font-normal text-[#dc2626]">rebuilt → state lost</span>
          </header>
          <div class="ka-pane" style={{ "view-transition-name": "ka-left" }}>
            <Show when={page() === "live"} fallback={<InboxScreen />}>
              <LiveSession seedRef={seedLeft} />
            </Show>
          </div>
        </div>

        <div class="flex-1">
          <header class="mb-2 flex items-center gap-2 text-[0.9rem] font-semibold">
            UnstableKeepAlive
            <span class="text-[0.72rem] font-normal text-[#16a34a]">same instance → survives</span>
          </header>
          <div class="ka-pane" style={{ "view-transition-name": "ka-right" }}>
            <KeepAlive key={page()}>
              {p => (p === "live" ? <LiveSession seedRef={seedRight} /> : <InboxScreen />)}
            </KeepAlive>
          </div>
        </div>
      </section>
    </div>
  );
}
