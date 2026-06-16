import { createSignal, For, Show } from "solid-js";
import { cx } from "./ui";

// --------------------------------------------------------------------------
// Transition monitor
//
// A clean cross-fade is, by design, almost invisible — so we narrate the live
// View Transition lifecycle (capture the snapshot → `ready` → animating →
// `finished`) in a small HUD. Crucially this is captured WITHOUT touching any
// component: `installTransitionMonitor()` patches `document.startViewTransition`
// once, so every transition Solid starts (tab switches and every demo) drives
// these shared signals. The demos keep calling `startViewTransition` exactly as
// they would in real code — nothing here leaks into their logic.
// --------------------------------------------------------------------------
export type VTPhase = "idle" | "capture" | "animate" | "done";

export const vtPhaseLabel: Record<VTPhase, string> = {
  idle: "idle",
  capture: "capturing snapshot",
  animate: "animating",
  done: "finished"
};

export const [vtPhase, setVtPhase] = createSignal<VTPhase>("idle");
export const [vtTypes, setVtTypes] = createSignal<string[]>([]);

export function installTransitionMonitor() {
  const native = document.startViewTransition as
    | ((arg?: unknown) => {
        ready?: Promise<unknown>;
        finished?: Promise<unknown>;
        types?: Iterable<string>;
      })
    | undefined;
  if (typeof native !== "function" || (native as { __monitored?: boolean }).__monitored) return;

  let token = 0;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  const patched = function (this: Document, arg?: unknown) {
    const mine = ++token;
    clearTimeout(idleTimer);
    // Types passed up-front arrive on the options arg; types added later via
    // addTransitionType land during the update callback, so we re-read them off
    // the live transition at `ready` (when the callback has run).
    const seed =
      arg &&
      typeof arg === "object" &&
      "types" in arg &&
      (arg as { types?: Iterable<string> }).types
        ? [...(arg as { types: Iterable<string> }).types]
        : [];
    setVtTypes(seed);
    setVtPhase("capture");

    const result = native.apply(this, arguments as unknown as [unknown]);

    const syncTypes = () => {
      try {
        if (result?.types) setVtTypes([...result.types]);
      } catch {
        /* types unsupported — keep the seed */
      }
    };
    Promise.resolve(result?.ready)
      .then(() => {
        if (mine !== token) return;
        syncTypes();
        setVtPhase("animate");
      })
      .catch(() => {});
    Promise.resolve(result?.finished)
      .catch(() => {})
      .finally(() => {
        if (mine !== token) return;
        setVtPhase("done");
        idleTimer = setTimeout(() => mine === token && setVtPhase("idle"), 1000);
      });

    return result;
  };
  (patched as { __monitored?: boolean }).__monitored = true;

  try {
    document.startViewTransition = patched as typeof document.startViewTransition;
  } catch {
    /* read-only in this engine — the HUD just stays idle */
  }
}

const steps: VTPhase[] = ["idle", "capture", "animate", "done"];
const stageOrder = (p: VTPhase) => steps.indexOf(p);
const cells: Array<{ id: VTPhase; label: string }> = [
  { id: "capture", label: "capture" },
  { id: "animate", label: "animate" },
  { id: "done", label: "done" }
];

// The live instrument shown inside a demo's info panel. `names` lists the
// `view-transition-name`s this demo registers; the phase/type readout is shared
// across the whole workbench so any transition lights it up.
export function TransitionMonitor(props: { names: string[]; caption?: string }) {
  return (
    <div
      class={cx(
        "mt-auto grid gap-[11px] rounded-xl border p-[13px_16px] transition-[border-color,box-shadow] duration-200",
        "bg-[linear-gradient(180deg,rgba(255,255,255,0.7),rgba(255,255,255,0.4)),repeating-linear-gradient(-45deg,transparent_0_7px,rgba(44,79,124,0.035)_7px_8px)]",
        vtPhase() !== "idle"
          ? "border-[rgba(44,79,124,0.4)] shadow-[0_12px_30px_-20px_rgba(35,79,75,0.6)]"
          : "border-line"
      )}
    >
      <div class="flex items-center gap-2.5">
        <span class="vt-led" data-phase={vtPhase()} aria-hidden="true" />
        <span class="font-mono text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-ink">
          View Transition
        </span>
        <span class="ml-auto font-mono text-[0.78rem] font-semibold text-solid-ink">
          {vtPhaseLabel[vtPhase()]}
        </span>
      </div>

      <ol class="m-0 grid list-none grid-cols-3 p-0" aria-hidden="true">
        <For each={cells}>
          {(cell, i) => {
            const on = () => vtPhase() === cell.id;
            const past = () => vtPhase() !== "idle" && stageOrder(vtPhase()) >= stageOrder(cell.id);
            return (
              <li
                class={cx(
                  "relative flex flex-col items-center gap-[7px] font-mono text-[0.72rem] transition-[color,opacity] duration-200",
                  on()
                    ? "font-semibold text-ink opacity-100"
                    : past()
                      ? "text-solid-ink opacity-100"
                      : "text-muted opacity-65"
                )}
              >
                <Show when={i() < cells.length - 1}>
                  <span class="absolute left-1/2 right-[-50%] top-[5px] z-0 h-0.5 bg-line" />
                </Show>
                <span
                  class={cx(
                    "relative z-[1] h-[11px] w-[11px] rounded-full border-2 transition-[background,border-color,transform] duration-200",
                    past() ? "border-[#2c4f7c] bg-solid" : "border-[rgba(32,36,43,0.28)] bg-paper",
                    on() && "scale-[1.3] shadow-[0_0_0_4px_rgba(44,79,124,0.22)]"
                  )}
                />
                <span>{cell.label}</span>
              </li>
            );
          }}
        </For>
      </ol>

      <dl class="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2">
        <dt class="self-center font-mono text-[0.7rem] uppercase tracking-[0.1em] text-muted">
          type
        </dt>
        <dd class="m-0 flex flex-wrap gap-1.5">
          <Show when={vtTypes().length} fallback={<code class="text-muted opacity-70">—</code>}>
            <For each={vtTypes()}>{type => <code>{type}</code>}</For>
          </Show>
        </dd>
        <dt class="self-center font-mono text-[0.7rem] uppercase tracking-[0.1em] text-muted">
          name
        </dt>
        <dd class="m-0 flex flex-wrap gap-1.5">
          <For each={props.names}>{name => <code>{name}</code>}</For>
        </dd>
      </dl>

      <Show when={props.caption}>
        <p class="m-0 text-[0.8rem] leading-[1.45] text-muted">{props.caption}</p>
      </Show>
    </div>
  );
}
