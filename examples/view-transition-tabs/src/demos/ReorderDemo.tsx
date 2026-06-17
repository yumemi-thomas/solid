import { addTransitionType, ViewTransition } from "@solidjs/web";
import { createSignal, For, startTransition } from "solid-js";
import { chip, cx, desc, panelBox, Panel, primaryBtn } from "../ui";

const accentBg: Record<string, string> = {
  blue: "bg-[#335d92]",
  green: "bg-[#2c4f7c]",
  amber: "bg-[#4f88c6]",
  plum: "bg-[#1f3a5f]"
};

export function ReorderDemo() {
  const initial = [
    { id: "compile", label: "Compile", accent: "blue" },
    { id: "hydrate", label: "Hydrate", accent: "green" },
    { id: "settle", label: "Settle", accent: "amber" },
    { id: "paint", label: "Paint", accent: "plum" }
  ];
  const [items, setItems] = createSignal(initial);

  const rotate = () => {
    startTransition(() => {
      addTransitionType("reorder");
      setItems(list => [list[1], list[2], list[3], list[0]]);
    });
  };

  const reverse = () => {
    startTransition(() => {
      addTransitionType("reorder");
      setItems(list => [...list].reverse());
    });
  };

  return (
    <div class="grid items-stretch gap-3 grid-cols-[minmax(280px,0.9fr)_minmax(360px,1.2fr)] max-[860px]:grid-cols-1">
      <Panel>
        <h2>Reordering list items</h2>
        <p class={desc}>
          Each item has a stable transition name, so layout changes animate as update transitions
          when the list order changes.
        </p>
        <div class="flex flex-wrap gap-2">
          <button type="button" class={primaryBtn} onClick={rotate}>
            Rotate
          </button>
          <button type="button" class={chip()} onClick={reverse}>
            Reverse
          </button>
        </div>
      </Panel>

      <section
        class={cx(panelBox, "grid grid-cols-2 content-center gap-[18px] max-[860px]:grid-cols-1")}
      >
        <For each={items()}>
          {(item, index) => (
            <ViewTransition
              name={`step-${item.id}`}
              default="step-transition"
              update={{ reorder: "step-reorder", default: "step-transition" }}
            >
              <article
                class={cx(
                  "grid min-h-[150px] content-between gap-[22px] rounded-[7px] p-[18px] text-white",
                  accentBg[item.accent]
                )}
              >
                <span class="text-[0.84rem] font-extrabold opacity-75">
                  {String(index() + 1).padStart(2, "0")}
                </span>
                <strong class="text-[1.35rem]">{item.label}</strong>
              </article>
            </ViewTransition>
          )}
        </For>
      </section>
    </div>
  );
}
