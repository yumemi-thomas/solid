import { addTransitionType, ViewTransition } from "@solidjs/web";
import { createMemo, createSignal, For, Show, startTransition } from "solid-js";
import { cx, desc, Panel, panelCol } from "../ui";

type GalleryId = "aurora" | "reef" | "harbor";

const galleryItems: Array<{
  id: GalleryId;
  title: string;
  theme: string;
  stat: string;
  copy: string;
}> = [
  {
    id: "aurora",
    title: "Aurora launch",
    theme: "plum",
    stat: "42 ms",
    copy: "A same-name card moves from the grid into the detail slot."
  },
  {
    id: "reef",
    title: "Reef metrics",
    theme: "teal",
    stat: "18 jobs",
    copy: "The old card and new detail share the same view-transition-name."
  },
  {
    id: "harbor",
    title: "Harbor audit",
    theme: "amber",
    stat: "7 diffs",
    copy: "The component stays router-free; the app decides when updates run."
  }
];

// 135° theme gradients shared by the compact card face and the detail card.
const themeBg: Record<string, string> = {
  plum: "bg-gradient-to-br from-[#1f3a5f] to-[#335d92]",
  teal: "bg-gradient-to-br from-[#2c4f7c] to-[#4f88c6]",
  amber: "bg-gradient-to-br from-[#4f88c6] to-[#76b3e1]"
};

function CardFace(props: { title: string; stat: string; theme: string }) {
  return (
    <span
      class={cx(
        "grid min-h-full content-between gap-[26px] rounded-[7px] p-[18px] text-white",
        themeBg[props.theme]
      )}
    >
      <strong class="[overflow-wrap:anywhere]">{props.title}</strong>
      <em class="not-italic text-white/80">{props.stat}</em>
    </span>
  );
}

export function SharedCardDemo() {
  const [selected, setSelected] = createSignal<GalleryId>("aurora");
  const current = createMemo(() => galleryItems.find(item => item.id === selected())!);

  const choose = (id: GalleryId) => {
    startTransition(() => {
      addTransitionType("share");
      setSelected(id);
    });
  };

  return (
    <div class="grid items-stretch gap-3 grid-cols-[minmax(280px,0.9fr)_minmax(360px,1.2fr)] max-[860px]:grid-cols-1">
      <Panel>
        <h2>Shared element transition</h2>
        <p class={desc}>
          Pick a card. The compact card and the detail panel use the same transition name, so
          replacement is treated as a share rather than a separate exit and enter.
        </p>
        <div class="grid gap-2.5">
          <For each={galleryItems}>
            {item => (
              <button
                type="button"
                class={cx(
                  "min-h-[104px] cursor-pointer rounded-[7px] border border-line-strong bg-transparent p-0 text-left",
                  selected() === item.id && "outline outline-[3px] outline-[rgba(44,79,124,0.2)]"
                )}
                onClick={() => choose(item.id)}
              >
                <Show
                  when={selected() !== item.id}
                  fallback={<CardFace title={item.title} stat={item.stat} theme={item.theme} />}
                >
                  <ViewTransition name={`gallery-${item.id}`} share="card-share">
                    <CardFace title={item.title} stat={item.stat} theme={item.theme} />
                  </ViewTransition>
                </Show>
              </button>
            )}
          </For>
        </div>
      </Panel>

      <section class={cx(panelCol, "justify-stretch")}>
        <ViewTransition
          name={`gallery-${current().id}`}
          default="detail-transition"
          share="card-share"
          update={{ share: "card-share", default: "detail-update" }}
        >
          <article
            class={cx(
              "grid min-h-[420px] content-end gap-[14px] rounded-[7px] p-[18px] text-white",
              themeBg[current().theme]
            )}
          >
            <span class="text-[0.82rem] font-extrabold uppercase opacity-80">{current().stat}</span>
            <h3 class="text-[clamp(2rem,5vw,4.8rem)] leading-[0.95] [overflow-wrap:anywhere]">
              {current().title}
            </h3>
            <p class="text-[1.05rem] text-white/80">{current().copy}</p>
          </article>
        </ViewTransition>
      </section>
    </div>
  );
}
