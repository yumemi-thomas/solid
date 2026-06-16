import { addTransitionType, startViewTransition, ViewTransition } from "@solidjs/web";
import { createSignal, flush, For, Show } from "solid-js";
import { chip, cx, desc, kicker, Panel, panelBox, primaryBtn } from "../ui";

const pages = [
  {
    id: "browse",
    tag: "01 · Browse",
    title: "Pick a workspace",
    body: "Choose where the project lives — the new screen slides in from the side you're heading."
  },
  {
    id: "config",
    tag: "02 · Configure",
    title: "Set your defaults",
    body: "Forward navigation enters from the right; the screen you left exits to the left."
  },
  {
    id: "invite",
    tag: "03 · Invite",
    title: "Add your team",
    body: "Back navigation reverses it — the same component, animated the other way."
  },
  {
    id: "launch",
    tag: "04 · Launch",
    title: "Ship it",
    body: "Direction is just a transition type the enter/exit classes are keyed on."
  }
];

// Each step is its own named group, so a navigation captures the old screen
// (exiting) and the new one (entering) as two independent transitions that play
// at once. `route-card` is the marker the tab-switch override drops the name on.
const toneBg: Record<string, string> = {
  browse: "bg-gradient-to-br from-[#1f3a5f] to-[#335d92]",
  config: "bg-gradient-to-br from-[#2c4f7c] to-[#4f88c6]",
  invite: "bg-gradient-to-br from-[#335d92] to-[#76b3e1]",
  launch: "bg-gradient-to-br from-[#1f3a5f] to-[#2c4f7c]"
};

export function DirectionalNavDemo() {
  const [index, setIndex] = createSignal(0);

  const go = (next: number, dir: "forward" | "back") => {
    if (next < 0 || next >= pages.length) return;
    // The direction is the whole trick: the same enter/exit props pick a class by
    // the active transition type, so "forward" slides left→right and "back" mirrors it.
    startViewTransition(() => {
      addTransitionType(dir);
      setIndex(next);
      flush();
    });
  };

  const page = () => pages[index()];

  return (
    <div class="grid items-stretch gap-3 grid-cols-[minmax(280px,0.9fr)_minmax(360px,1.2fr)] max-[860px]:grid-cols-1">
      <Panel>
        <span class={kicker}>Direction by transition type</span>
        <h2>Forward &amp; back, two directions</h2>
        <p class={desc}>
          Next slides the new screen in from the right while the old leaves to the left; Back
          mirrors it. The direction is just <code>addTransitionType("forward")</code> vs{" "}
          <code>"back"</code>, and the <code>enter</code>/<code>exit</code> classes are keyed on
          that type.
        </p>
        <div class="flex gap-2">
          <button
            type="button"
            class={chip()}
            disabled={index() === 0}
            onClick={() => go(index() - 1, "back")}
          >
            ← Back
          </button>
          <button
            type="button"
            class={primaryBtn}
            disabled={index() === pages.length - 1}
            onClick={() => go(index() + 1, "forward")}
          >
            Next →
          </button>
        </div>
        <div class="flex items-center gap-1.5" aria-hidden="true">
          <For each={pages}>
            {(_, i) => (
              <span
                class={cx(
                  "h-1.5 rounded-full transition-all duration-300",
                  i() === index() ? "w-6 bg-solid" : "w-1.5 bg-line-strong"
                )}
              />
            )}
          </For>
        </div>
      </Panel>

      <section class={cx(panelBox, "relative overflow-hidden")}>
        <Show when={page()} keyed>
          {p => (
            <ViewTransition
              name={`route-${p.id}`}
              enter={{ forward: "route-in-right", back: "route-in-left" }}
              exit={{ forward: "route-out-left", back: "route-out-right" }}
            >
              <article
                class={cx(
                  "route-card grid min-h-[316px] content-end gap-3 rounded-[7px] p-6 text-white",
                  toneBg[p.id]
                )}
              >
                <span class="font-mono text-[0.72rem] tracking-[0.04em] opacity-80">{p.tag}</span>
                <h3 class="text-[clamp(1.8rem,4vw,3rem)] leading-[0.98] [overflow-wrap:anywhere]">
                  {p.title}
                </h3>
                <p class="text-[1.02rem] text-white/85">{p.body}</p>
              </article>
            </ViewTransition>
          )}
        </Show>
      </section>
    </div>
  );
}
