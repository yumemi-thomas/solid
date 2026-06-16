import { addTransitionType, startViewTransition, ViewTransition } from "@solidjs/web";
import { createSignal, flush, For, Show } from "solid-js";
import { cx, desc, kicker, Panel, panelBox, primaryBtn } from "../ui";

type Item = { id: number; label: string; tone: string };

const labels = ["Compile", "Hydrate", "Render", "Paint", "Settle", "Commit", "Flush", "Reveal"];
const tones = ["bg-[#335d92]", "bg-[#4f88c6]", "bg-[#2c4f7c]", "bg-[#1f3a5f]", "bg-[#76b3e1]"];

const MAX = 6;

export function AddRemoveDemo() {
  let seq = 0;
  const make = (): Item => {
    const id = ++seq;
    return {
      id,
      label: `${labels[(id - 1) % labels.length]} step`,
      tone: tones[(id - 1) % tones.length]
    };
  };
  const [items, setItems] = createSignal<Item[]>([make(), make(), make()]);

  // Insert at the top so the new row enters while the existing rows slide down
  // (their stable names make that an `update` reposition, not a re-mount).
  const add = () => {
    if (items().length >= MAX) return;
    startViewTransition(() => {
      addTransitionType("add");
      setItems(list => [make(), ...list]);
      flush();
    });
  };

  const remove = (id: number) => {
    startViewTransition(() => {
      addTransitionType("remove");
      setItems(list => list.filter(item => item.id !== id));
      flush();
    });
  };

  return (
    <div class="grid items-stretch gap-3 grid-cols-[minmax(280px,0.9fr)_minmax(360px,1.2fr)] max-[860px]:grid-cols-1">
      <Panel>
        <span class={kicker}>Enter · exit · move</span>
        <h2>Add &amp; remove list items</h2>
        <p class={desc}>
          Adding inserts a row at the top — it animates <em>in</em> while the others slide down to
          make room. Removing animates that row <em>out</em> and the rest close the gap. Each row
          keeps a stable <code>view-transition-name</code>, so the repositioning is a single{" "}
          <code>update</code> transition.
        </p>
        <div class="flex flex-wrap gap-2">
          <button type="button" class={primaryBtn} onClick={add} disabled={items().length >= MAX}>
            + Add step
          </button>
          <span class="self-center text-[0.82rem] text-muted">
            {items().length}/{MAX}
          </span>
        </div>
      </Panel>

      <section class={cx(panelBox, "min-h-[360px]")}>
        <Show
          when={items().length}
          fallback={
            <div class="grid h-full min-h-[316px] place-items-center text-[0.9rem] text-muted">
              All steps removed — add one back.
            </div>
          }
        >
          <ul class="m-0 grid list-none gap-2 p-px">
            <For each={items()}>
              {item => (
                <ViewTransition
                  name={`item-${item.id}`}
                  enter="vt-item-enter"
                  exit="vt-item-exit"
                  update="vt-item-move"
                >
                  <li class="item-card flex items-center gap-3 rounded-[11px] border border-line bg-white px-[14px] py-3 shadow-[0_1px_2px_rgba(15,29,51,0.04)]">
                    <span
                      class={cx("h-7 w-1.5 flex-none rounded-full", item.tone)}
                      aria-hidden="true"
                    />
                    <span class="flex-1 font-medium text-ink">{item.label}</span>
                    <button
                      type="button"
                      class="grid h-7 w-7 flex-none cursor-pointer place-items-center rounded-lg border border-line text-[1.1rem] leading-none text-muted transition-[background,color,border-color] duration-[140ms] hover:border-[rgba(220,38,38,0.4)] hover:bg-[rgba(220,38,38,0.08)] hover:text-[#dc2626]"
                      aria-label={`Remove ${item.label}`}
                      onClick={() => remove(item.id)}
                    >
                      ×
                    </button>
                  </li>
                </ViewTransition>
              )}
            </For>
          </ul>
        </Show>
      </section>
    </div>
  );
}
