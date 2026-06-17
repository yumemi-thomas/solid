import { addTransitionType, render, startViewTransition, ViewTransition } from "@solidjs/web";
import { createSignal, flush, For, Show, startTransition } from "solid-js";
import { cx, eyebrow } from "./ui";
import { installTransitionMonitor, vtPhase, vtPhaseLabel } from "./vt-monitor";
import { SharedCardDemo } from "./demos/SharedCardDemo";
import { AsyncLoadingDemo } from "./demos/AsyncLoadingDemo";
import { RevealDemo } from "./demos/RevealDemo";
import { ReorderDemo } from "./demos/ReorderDemo";
import { ActivityDemo } from "./demos/ActivityDemo";
import { AddRemoveDemo } from "./demos/AddRemoveDemo";
import { SettingsTabsDemo } from "./demos/SettingsTabsDemo";
import { DirectionalNavDemo } from "./demos/DirectionalNavDemo";
import { GestureScrubDemo } from "./demos/GestureScrubDemo";
import { HideShowDemo } from "./demos/HideShowDemo";
import { TodoDemo } from "./demos/todo/TodoDemo";
import "./styles.css";

type TabId =
  | "gallery"
  | "async"
  | "reveal"
  | "todo"
  | "reorder"
  | "activity"
  | "settings"
  | "toggle"
  | "route"
  | "list"
  | "scrub";

const tabs: Array<{ id: TabId; label: string; caption: string }> = [
  { id: "gallery", label: "Shared Card", caption: "enter, exit, share" },
  { id: "async", label: "Async Loading", caption: "native update callback" },
  { id: "reveal", label: "Reveal Group", caption: "coordinated async" },
  { id: "todo", label: "Async Todo", caption: "optimistic + reveal" },
  { id: "reorder", label: "List Reorder", caption: "position updates" },
  { id: "activity", label: "Activity Cache", caption: "kept mounted" },
  { id: "settings", label: "Tabbed Forms", caption: "state per tab" },
  { id: "toggle", label: "Hide & Show", caption: "enter + exit" },
  { id: "route", label: "Directional Nav", caption: "forward / back" },
  { id: "list", label: "Add & Remove", caption: "enter / exit / move" },
  { id: "scrub", label: "Keep Alive", caption: "survives swipe-back" }
];

function App() {
  const [activeTab, setActiveTab] = createSignal<TabId>("gallery");

  const selectTab = (id: TabId) => {
    // A synchronous change made into a transition: the auto seam wraps the commit
    // in a view transition. `addTransitionType("tab")` is captured at commit (read
    // before the browser snapshots the old state), so `:active-view-transition-type(tab)`
    // suppresses the inner named groups (lanes / report card) during capture.
    startTransition(() => {
      addTransitionType("tab");
      setActiveTab(id);
    });
  };

  const isLive = () => vtPhase() !== "idle";

  return (
    <main class="mx-auto w-[min(1180px,calc(100vw-32px))] py-8">
      <section class="mb-[18px] flex min-h-28 items-end justify-between gap-6 max-[860px]:grid max-[860px]:items-start">
        <div>
          <p class={eyebrow}>Solid 2.0 web runtime · native View Transitions</p>
          <h1>
            ViewTransition{" "}
            <span class="bg-[linear-gradient(125deg,#76b3e1_0%,#4f88c6_48%,#335d92_100%)] bg-clip-text font-extrabold text-transparent">
              workbench
            </span>
          </h1>
        </div>
        <div class="flex flex-col items-end gap-2.5 text-[0.82rem] max-[860px]:items-start">
          <span
            class={cx(
              "inline-flex items-center gap-[9px] rounded-full border py-2 pl-[11px] pr-[14px] font-mono text-[0.74rem] tracking-[0.01em] transition-[border-color,background,box-shadow] duration-200",
              isLive()
                ? "border-[rgba(44,79,124,0.5)] bg-solid/10 shadow-[0_0_0_3px_rgba(44,79,124,0.1)]"
                : "border-line bg-white/70"
            )}
          >
            <span class="vt-led" data-phase={vtPhase()} aria-hidden="true" />
            <span class="text-muted">view transition</span>
            {/* Reserve width for the longest label ("capturing snapshot") so the
                chip never resizes as the phase changes. */}
            <span class="w-[19ch] whitespace-nowrap font-semibold text-solid-ink">
              {vtPhaseLabel[vtPhase()]}
            </span>
          </span>
          <span class="font-mono text-[0.72rem] tracking-[0.02em] text-muted">
            router independent · async-native
          </span>
        </div>
      </section>

      <nav
        class="mb-3 grid grid-cols-4 gap-2 max-[860px]:grid-cols-1"
        aria-label="ViewTransition demos"
      >
        <For each={tabs}>
          {tab => (
            <button
              type="button"
              class={cx(
                "grid min-h-[68px] cursor-pointer gap-[3px] rounded-lg border p-3 text-left transition-[background,border-color,transform] duration-[160ms]",
                activeTab() === tab.id
                  ? "border-transparent bg-[linear-gradient(135deg,#335d92,#2c4f7c)] text-white shadow-[0_10px_24px_-14px_rgba(44,79,124,0.9)]"
                  : "border-[rgba(15,29,51,0.12)] bg-white/[0.64] hover:-translate-y-px hover:border-[rgba(44,79,124,0.35)]"
              )}
              aria-current={activeTab() === tab.id ? "page" : undefined}
              onClick={() => selectTab(tab.id)}
            >
              <span class="font-extrabold">{tab.label}</span>
              <small class={activeTab() === tab.id ? "text-[#cfe0f3]" : "text-muted"}>
                {tab.caption}
              </small>
            </button>
          )}
        </For>
      </nav>

      <Show when={activeTab()} keyed>
        {tab => (
          <ViewTransition
            name={`demo-panel-${tab}`}
            default="panel-transition"
            enter="panel-transition"
            exit="panel-transition"
          >
            {/* Size to the active demo's content (with a sensible floor) instead of a
                fixed height that would clip — the panel transition animates the resize. */}
            <section class="min-h-[480px] rounded-lg border border-line bg-white/[0.56] p-3 max-[860px]:min-h-0">
              <Show when={tab === "gallery"}>
                <SharedCardDemo />
              </Show>
              <Show when={tab === "async"}>
                <AsyncLoadingDemo />
              </Show>
              <Show when={tab === "reveal"}>
                <RevealDemo />
              </Show>
              <Show when={tab === "todo"}>
                <TodoDemo />
              </Show>
              <Show when={tab === "reorder"}>
                <ReorderDemo />
              </Show>
              <Show when={tab === "activity"}>
                <ActivityDemo />
              </Show>
              <Show when={tab === "settings"}>
                <SettingsTabsDemo />
              </Show>
              <Show when={tab === "toggle"}>
                <HideShowDemo />
              </Show>
              <Show when={tab === "route"}>
                <DirectionalNavDemo />
              </Show>
              <Show when={tab === "list"}>
                <AddRemoveDemo />
              </Show>
              <Show when={tab === "scrub"}>
                <GestureScrubDemo />
              </Show>
            </section>
          </ViewTransition>
        )}
      </Show>
    </main>
  );
}

installTransitionMonitor();

// Automatic view transitions are on by default (React parity): just mounting a
// <ViewTransition> opts in, so any transition commit under a boundary auto-wraps
// in document.startViewTransition with no setup call. Async demos form
// transitions on their own (data loads, actions, Reveal); synchronous demos use
// `startTransition(...)` to make their change a transition. `startViewTransition`
// is now only the explicit escape hatch — used here to animate the initial mount.

let disposeApp: (() => void) | undefined;
startViewTransition(() => {
  disposeApp = render(() => <App />, document.getElementById("root")!);
  flush();
});

// Dispose the mounted tree before Vite hot-replaces this module. Without this, an
// HMR update re-runs `render(<App/>)` and appends a second App, so every named
// <ViewTransition> ends up mounted twice — which trips the dev "two components
// with the same name" warning. Disposing first keeps a single live tree.
if (import.meta.hot) {
  import.meta.hot.dispose(() => disposeApp?.());
}
