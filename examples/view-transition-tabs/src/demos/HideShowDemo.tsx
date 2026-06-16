import { Activity, addTransitionType, startViewTransition, ViewTransition } from "@solidjs/web";
import { createSignal, flush } from "solid-js";
import { chip, cx, desc, kicker, Panel, panelBox, primaryBtn } from "../ui";

// A self-contained counter with its own local state. It lives inside an
// <Activity> that only HIDES it (never unmounts), so the count survives every
// hide/show cycle — while the wrapping <ViewTransition> animates it out (exit)
// and back in (enter). `counter-card` is the marker class the tab-switch
// override uses to drop the name so it rides inside the panel fade.
function Counter() {
  const [count, setCount] = createSignal(3);
  return (
    <div class="counter-card grid content-center justify-items-center gap-5 rounded-xl border border-line bg-[linear-gradient(180deg,#ffffff,#eef4fb)] p-8 text-center shadow-[0_1px_2px_rgba(15,29,51,0.04)]">
      <span class="text-[0.72rem] font-bold uppercase tracking-[0.12em] text-solid">
        Live counter
      </span>
      <strong class="font-display text-[clamp(3.5rem,9vw,6rem)] font-extrabold leading-none text-solid-ink tabular-nums">
        {count()}
      </strong>
      <div class="flex gap-2">
        <button
          type="button"
          class={chip()}
          onClick={() => setCount(c => c - 1)}
          aria-label="Decrement"
        >
          −1
        </button>
        <button
          type="button"
          class={chip()}
          onClick={() => setCount(c => c + 1)}
          aria-label="Increment"
        >
          +1
        </button>
      </div>
    </div>
  );
}

export function HideShowDemo() {
  const [visible, setVisible] = createSignal(true);

  const toggle = () => {
    // Pass the direction up-front so enter/exit can animate accordingly, and the
    // HUD shows the active type. The change commits inside startViewTransition,
    // so hiding plays `exit` and showing plays `enter`.
    startViewTransition(() => {
      addTransitionType(visible() ? "hide" : "show");
      setVisible(v => !v);
      flush();
    });
  };

  return (
    <div class="grid items-stretch gap-3 grid-cols-[minmax(280px,0.9fr)_minmax(360px,1.2fr)] max-[860px]:grid-cols-1">
      <Panel>
        <span class={kicker}>Enter + exit animation</span>
        <h2>Hide &amp; show, state kept</h2>
        <p class={desc}>
          Bump the counter, then hide it: the card animates <em>out</em> (exit) and back <em>in</em>{" "}
          (enter). It's wrapped in <code>Activity mode="hidden"</code>, so it's only hidden — never
          unmounted — and the count survives every cycle.
        </p>
        <button type="button" class={primaryBtn} onClick={toggle}>
          {visible() ? "Hide counter" : "Show counter"}
        </button>
      </Panel>

      <section class={cx(panelBox, "grid min-h-[320px] content-center")}>
        <Activity mode={visible() ? "visible" : "hidden"}>
          <ViewTransition name="hide-show-counter" enter="counter-enter" exit="counter-exit">
            <Counter />
          </ViewTransition>
        </Activity>
      </section>
    </div>
  );
}
