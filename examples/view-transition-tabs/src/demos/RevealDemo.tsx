import { addTransitionType, Loading, Reveal, ViewTransition } from "@solidjs/web";
import { createMemo, createSignal } from "solid-js";
import { cx, desc, panelBox, Panel, primaryBtn, Shimmer, kicker } from "../ui";
import { TransitionMonitor } from "../vt-monitor";

const laneBg = {
  green: "bg-gradient-to-br from-[#2c4f7c] to-[#10243d]",
  blue: "bg-gradient-to-br from-[#335d92] to-[#4f88c6]"
};

// `lane-card` stays a real class: a global rule maps it to view-transition-class
// `lane`, and `:active-view-transition-type(tab)` drops its name so it rides
// inside the panel fade on a tab switch.
const laneBase = "lane-card grid min-h-[260px] content-end gap-[14px] rounded-[7px] p-[18px]";

function LaneCard(props: { label: string; tone: "green" | "blue" }) {
  return (
    <article class={cx(laneBase, "text-white", laneBg[props.tone])}>
      <span class="font-mono text-[0.68rem] tracking-[0.02em]">
        {props.tone === "green" ? "lane-left · north" : "lane-right · south"}
      </span>
      <h3>{props.label}</h3>
      <p class="text-[0.86rem] text-white/85">resolved · swapped in with its sibling</p>
    </article>
  );
}

function LaneFallback(props: { tone: "green" | "blue" }) {
  return (
    <article
      class={cx(
        laneBase,
        "relative overflow-hidden border border-dashed border-[rgba(15,29,51,0.2)] bg-[#eef1f3] text-[#30343b]"
      )}
    >
      <span class="font-mono text-[0.68rem] tracking-[0.02em]">
        {props.tone === "green" ? "lane-left · north" : "lane-right · south"}
      </span>
      <h3>
        Waiting
        <span class="lane-dots" aria-hidden="true" />
      </h3>
      <p class="text-[0.86rem] text-[#6b7180]">held by the reveal group until both lanes land</p>
      <Shimmer active />
    </article>
  );
}

export function RevealDemo() {
  const [cycle, setCycle] = createSignal(0);
  const left = createMemo(async () => {
    const value = cycle();
    await new Promise(r => setTimeout(r, 360));
    return `North lane ${value + 1}`;
  });
  const right = createMemo(async () => {
    const value = cycle();
    await new Promise(r => setTimeout(r, 780));
    return `South lane ${value + 1}`;
  });

  const refreshBoth = () => {
    // Automatic view transitions: bumping `cycle` makes both lane memos go
    // pending. They sit in one `Reveal order="together"` group, so the scheduler
    // holds the commit until both resolve, then auto-wraps the synchronized
    // waiting → resolved swap as one transition. The "reveal" type is carried
    // onto the transition from this synchronous declaration.
    addTransitionType("reveal");
    setCycle(value => value + 1);
  };

  return (
    <div class="grid items-stretch gap-3 grid-cols-[minmax(280px,0.9fr)_minmax(360px,1.2fr)] max-[860px]:grid-cols-1">
      <Panel>
        <span class={kicker}>Coordinated async + transition</span>
        <h2>Reveal group, one frame</h2>
        <p class={desc}>
          The two lanes resolve at <em>different</em> speeds, but both live in one{" "}
          <code>Reveal order="together"</code> group — so the fast one waits, and they cross-fade
          from <em>waiting</em> to <em>resolved</em> together, as one transition.
        </p>
        <button type="button" class={primaryBtn} onClick={refreshBoth}>
          Refresh both lanes
        </button>
        <TransitionMonitor
          names={["lane-left", "lane-right"]}
          caption="Two named boundaries, one synchronized swap — no half-loaded in-between state."
        />
      </Panel>

      <section class={cx(panelBox, "grid grid-cols-2 gap-[18px] max-[860px]:grid-cols-1")}>
        <Reveal order="together">
          <ViewTransition name="lane-left" default={{ reveal: "lane-transition" }}>
            <Loading fallback={<LaneFallback tone="green" />}>
              <LaneCard label={left()} tone="green" />
            </Loading>
          </ViewTransition>
          <ViewTransition name="lane-right" default={{ reveal: "lane-transition" }}>
            <Loading fallback={<LaneFallback tone="blue" />}>
              <LaneCard label={right()} tone="blue" />
            </Loading>
          </ViewTransition>
        </Reveal>
      </section>
    </div>
  );
}
