import { For, Show } from "solid-js";
import { cx } from "../../ui";
import {
  getTodoDelay,
  netLog,
  netNow,
  todoNetworks,
  type NetEntry,
  type TodoFilter
} from "./server";

// Blue-tinted shimmer bar used by the list skeleton.
const skel =
  "bg-[linear-gradient(90deg,#dde7f1,#f1f6fb,#dde7f1)] bg-[length:200%_100%] animate-[shimmer_1.2s_linear_infinite]";

export function TodoListSkeleton() {
  return (
    <ul class="grid list-none gap-2 p-px">
      <For each={[0, 1, 2, 3]}>{() => <li class={cx("h-[56px] rounded-[11px]", skel)} />}</For>
    </ul>
  );
}

export function TodoEmpty(props: { filter: TodoFilter; search: string }) {
  return (
    <div class="grid min-h-[200px] content-center justify-items-center gap-2 rounded-xl border border-dashed border-[rgba(15,29,51,0.2)] bg-[#f3f8fd] text-center">
      <strong class="font-display text-[1.15rem] font-extrabold">No lessons here</strong>
      <p class="text-muted">
        <Show
          when={props.search}
          fallback={`No ${props.filter === "done" ? "completed" : "in-progress"} lessons in this view.`}
        >
          No lessons match “{props.search}”.
        </Show>
      </p>
    </div>
  );
}

// async-react.dev's "network debugger": a light console listing the fake server
// round-trips with a method badge, a live timing bar, and elapsed ms. Driven by
// the shared `netLog`/`netNow` signals — purely presentational.
export function NetworkDebugger(props: {
  network: string;
  onNetwork: (id: string, ms: number) => void;
}) {
  const elapsed = (entry: NetEntry) =>
    Math.max(0, Math.round((entry.end ?? netNow()) - entry.start));
  const fill = (entry: NetEntry) =>
    entry.end !== undefined
      ? 100
      : Math.min(94, (elapsed(entry) / Math.max(150, getTodoDelay())) * 100);
  return (
    <section
      class="flex flex-none flex-col gap-2 rounded-xl border border-line bg-[linear-gradient(180deg,#ffffff,#eef4fb)] px-[14px] py-3 text-ink shadow-[0_1px_2px_rgba(15,29,51,0.04)]"
      aria-label="Network debugger"
    >
      <div class="flex items-center justify-between gap-2.5">
        <span class="inline-flex items-center gap-2 font-mono text-[0.72rem] font-semibold uppercase tracking-[0.12em] text-solid">
          <span
            class="h-[7px] w-[7px] rounded-full bg-solid shadow-[0_0_0_3px_rgba(44,79,124,0.18)] animate-[vt-pulse_1.4s_ease-in-out_infinite]"
            aria-hidden="true"
          />
          Network
        </span>
        <div class="flex gap-1 rounded-lg bg-[rgba(44,79,124,0.06)] p-[3px]">
          <For each={todoNetworks}>
            {preset => (
              <button
                type="button"
                class={cx(
                  "cursor-pointer rounded-md border-0 px-2.5 py-1 font-mono text-[0.72rem] font-semibold transition-[background,color] duration-[140ms]",
                  props.network === preset.id
                    ? "bg-solid text-white"
                    : "bg-transparent text-muted hover:text-solid"
                )}
                onClick={() => props.onNetwork(preset.id, preset.ms)}
              >
                {preset.label}
              </button>
            )}
          </For>
        </div>
      </div>
      <div class="flex h-[116px] flex-col gap-[3px] overflow-y-auto font-mono text-[0.74rem] [scrollbar-color:rgba(15,29,51,0.2)_transparent] [scrollbar-width:thin]">
        <Show
          when={netLog().length}
          fallback={
            <p class="m-auto text-[0.74rem] text-muted">
              Idle — search, filter or toggle to fire requests.
            </p>
          }
        >
          <For each={netLog()}>
            {entry => (
              <div
                class={cx(
                  "grid grid-cols-[44px_1fr_72px_56px] items-center gap-2.5 rounded-md px-1.5 py-1",
                  entry.end === undefined && "bg-[rgba(79,136,198,0.1)]"
                )}
              >
                <span
                  class={cx(
                    "rounded-[5px] py-0.5 text-center text-[0.66rem] font-bold tracking-[0.04em]",
                    entry.method === "GET"
                      ? "bg-[rgba(79,136,198,0.18)] text-solid-deep"
                      : "bg-[rgba(240,163,94,0.22)] text-[#b45309]"
                  )}
                >
                  {entry.method}
                </span>
                <span class="truncate text-ink">{entry.path}</span>
                <span
                  class="h-[5px] overflow-hidden rounded-full bg-[rgba(15,29,51,0.08)]"
                  aria-hidden="true"
                >
                  <span
                    class={cx(
                      "block h-full rounded-full transition-[width] duration-[90ms]",
                      entry.end === undefined
                        ? "bg-[linear-gradient(90deg,#4f88c6,#76b3e1,#4f88c6)] bg-[length:200%_100%] animate-[todo-sweep_1s_linear_infinite]"
                        : "bg-[linear-gradient(90deg,#4f88c6,#335d92)]"
                    )}
                    style={{ width: `${fill(entry)}%` }}
                  />
                </span>
                <span class="text-right tabular-nums text-muted">
                  {elapsed(entry)}
                  <i class="ml-px text-[0.85em] not-italic opacity-60">ms</i>
                </span>
              </div>
            )}
          </For>
        </Show>
      </div>
    </section>
  );
}
