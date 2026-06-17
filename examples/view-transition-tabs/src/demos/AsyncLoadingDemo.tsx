import { addTransitionType, Loading, ViewTransition } from "@solidjs/web";
import { createMemo, createSignal, For } from "solid-js";
import { chip, cx, desc, kicker, Panel, panelCol, wait } from "../ui";
import { TransitionMonitor } from "../vt-monitor";

const reports = {
  one: { title: "Pipeline health", value: "98.4%", detail: "All slow lanes drained before paint." },
  two: {
    title: "Release window",
    value: "14 min",
    detail: "Async data settled inside the transition callback."
  },
  three: {
    title: "Incident queue",
    value: "3 open",
    detail: "The fallback is visible while the scoped promise is pending."
  }
};

const shimmerBar =
  "rounded-full bg-[linear-gradient(90deg,#e2e6e9,#f6f7f8,#e2e6e9)] bg-[length:200%_100%] animate-[shimmer_1.2s_linear_infinite]";

function ReportFallback() {
  return (
    <article class="grid gap-[16px]">
      <span class={cx("block h-[18px]", shimmerBar)} />
      <span class={cx("block h-[80px]", shimmerBar)} />
      <span class={cx("block h-[18px] w-[70%]", shimmerBar)} />
      <span class={cx("block h-[18px] w-[48%]", shimmerBar)} />
    </article>
  );
}

export function AsyncLoadingDemo() {
  const [reportId, setReportId] = createSignal<keyof typeof reports>("one");
  const [request, setRequest] = createSignal(0);

  const report = createMemo(async () => {
    const id = reportId();
    request();
    await wait(620);
    return reports[id];
  });

  const loadReport = (id: keyof typeof reports) => {
    if (id === reportId()) return;
    // Automatic view transitions: no startViewTransition here. Writing the new id
    // makes the `report` memo go pending, which forms an async transition; the
    // scheduler holds the commit until `Loading` settles, then auto-wraps the
    // old → resolved swap as one cross-fade. `addTransitionType` is declared
    // synchronously and carried onto the transition (so `:active-view-transition-type(async)`
    // still matches at the deferred commit).
    addTransitionType("async");
    setReportId(id);
    setRequest(value => value + 1);
  };

  return (
    <div class="grid items-stretch gap-3 grid-cols-[minmax(280px,0.9fr)_minmax(360px,1.2fr)] max-[860px]:grid-cols-1">
      <Panel>
        <span class={kicker}>Suspense inside a transition</span>
        <h2>Async-native loading</h2>
        <p class={desc}>
          Picking a report scopes the change inside <code>startViewTransition</code>: the browser
          snapshots the <em>old</em> card, <code>Loading</code> settles the new one, then the two
          cross-fade — no spinner, no layout jump.
        </p>
        <div class="flex flex-wrap gap-2">
          <For each={Object.keys(reports) as Array<keyof typeof reports>}>
            {id => (
              <button type="button" class={chip(reportId() === id)} onClick={() => loadReport(id)}>
                {reports[id].title}
              </button>
            )}
          </For>
        </div>
        <TransitionMonitor
          names={["async-report"]}
          caption="One named boundary morphs old → new as a single animated transition."
        />
      </Panel>

      <ViewTransition
        name="async-report"
        default={{ async: "async-card-transition", default: "detail-transition" }}
        update={{ async: "async-card-transition", default: "detail-update" }}
      >
        <section class={cx(panelCol, "report-card relative justify-center")}>
          <span
            class="pointer-events-none absolute left-3 top-3 z-[2] rounded-full bg-[rgba(20,24,28,0.78)] px-[9px] py-1 font-mono text-[0.68rem] text-[#e9f3f1] backdrop-blur-[2px]"
            aria-hidden="true"
          >
            view-transition-name: async-report
          </span>
          <Loading fallback={<ReportFallback />}>
            <article class="grid min-h-[360px] content-center gap-[16px] rounded-lg bg-[#f8fbfc] p-[28px]">
              <span class="text-[0.82rem] font-extrabold uppercase opacity-80">Report</span>
              <h3>{report().title}</h3>
              <strong class="text-[clamp(3rem,8vw,7rem)] leading-[0.95] text-solid">
                {report().value}
              </strong>
              <p>{report().detail}</p>
            </article>
          </Loading>
        </section>
      </ViewTransition>
    </div>
  );
}
