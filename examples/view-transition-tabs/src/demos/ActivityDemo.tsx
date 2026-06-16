import { Activity, addTransitionType, startViewTransition, ViewTransition } from "@solidjs/web";
import { createEffect, createSignal, flush } from "solid-js";
import { chip, cx, desc, Panel, primaryBtn } from "../ui";

type PaneId = "notes" | "metrics";

// A live ticker driven by a `createEffect` side effect. Inside a hidden
// `<Activity>` the effect is PAUSED — its cleanup (clearInterval) runs and the
// timer stops; revealing the pane re-runs the effect and the timer resumes.
// State (the elapsed count) survives the hidden interval untouched.
function LiveUptime() {
  const [seconds, setSeconds] = createSignal(0);
  createEffect(
    () => {},
    () => {
      const id = setInterval(() => setSeconds(s => s + 1), 1000);
      return () => clearInterval(id);
    }
  );
  return (
    <div class="my-1.5 font-mono text-[#34d399]">
      ● live {seconds()}s (timer pauses while hidden)
    </div>
  );
}

const workspaceCard = "grid min-h-[380px] content-end gap-[14px] rounded-[7px] p-[18px]";

export function ActivityDemo() {
  const [activePane, setActivePane] = createSignal<PaneId>("notes");
  const [notesCount, setNotesCount] = createSignal(1);
  const [metricCount, setMetricCount] = createSignal(72);

  const selectPane = (pane: PaneId) => {
    // A tab switch is a discrete tap, not a scrub, so it's a plain
    // `startViewTransition` (which plays the cross-fade once and finishes). The
    // `activity` transition type drives the `activity-transition` class on the panes.
    startViewTransition(() => {
      addTransitionType("activity");
      setActivePane(pane);
      flush();
    });
  };

  return (
    <div class="grid items-stretch gap-3 grid-cols-[minmax(280px,0.9fr)_minmax(360px,1.2fr)] max-[860px]:grid-cols-1">
      <Panel>
        <h2>Activity cache across transitions</h2>
        <p class={desc}>
          The inactive pane is hidden with <code>Activity mode="hidden"</code>, so its local state
          is preserved while the visible pane transitions.
        </p>
        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            class={chip(activePane() === "notes")}
            onClick={() => selectPane("notes")}
          >
            Notes
          </button>
          <button
            type="button"
            class={chip(activePane() === "metrics")}
            onClick={() => selectPane("metrics")}
          >
            Metrics
          </button>
        </div>
      </Panel>

      <section class="activity-stack rounded-lg border border-line bg-white/70 p-[22px]">
        <Activity mode={activePane() === "notes" ? "visible" : "hidden"}>
          <ViewTransition name="activity-notes" default={{ activity: "activity-transition" }}>
            <article class={cx(workspaceCard, "bg-[#e9f1fb]")}>
              <span class="text-[0.82rem] font-extrabold uppercase opacity-80">Draft notes</span>
              <h3>{notesCount()} saved snippets</h3>
              <p class="text-muted">Switch away and back; this count stays mounted.</p>
              <button type="button" class={primaryBtn} onClick={() => setNotesCount(v => v + 1)}>
                Add note
              </button>
            </article>
          </ViewTransition>
        </Activity>

        <Activity mode={activePane() === "metrics" ? "visible" : "hidden"}>
          <ViewTransition name="activity-metrics" default={{ activity: "activity-transition" }}>
            <article class={cx(workspaceCard, "bg-[#dceaf8]")}>
              <span class="text-[0.82rem] font-extrabold uppercase opacity-80">Live metrics</span>
              <h3>{metricCount()} checks</h3>
              <LiveUptime />
              <p class="text-muted">
                Hidden Activity preserves state &amp; DOM, but PAUSES effects (React parity): switch
                to Notes and the live timer below stops; switch back and it resumes — its{" "}
                <code>createEffect</code> cleanup ran on hide.
              </p>
              <button type="button" class={primaryBtn} onClick={() => setMetricCount(v => v + 5)}>
                Run checks
              </button>
            </article>
          </ViewTransition>
        </Activity>
      </section>
    </div>
  );
}
