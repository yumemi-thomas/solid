import type { JSX } from "@solidjs/web/jsx-runtime";

/** Join truthy class fragments. */
export const cx = (...parts: Array<string | false | null | undefined>) =>
  parts.filter(Boolean).join(" ");

export function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// --------------------------------------------------------------------------
// Shared Tailwind class strings. Kept as constants (not bespoke CSS) so the
// look stays consistent across demos while the stylesheet holds only what
// Tailwind genuinely can't express (View Transition pseudo-elements + keyframes).
// --------------------------------------------------------------------------

/** Panel surface without a display mode — compose with `grid`/`flex` as needed. */
export const panelBox = "min-w-0 rounded-lg border border-line bg-white/70 p-[22px]";

/** The default panel: a vertical stack on the panel surface. */
export const panelCol = `flex flex-col gap-[18px] ${panelBox}`;

export const demoGrid =
  "grid items-stretch gap-3 grid-cols-[minmax(280px,0.9fr)_minmax(360px,1.2fr)] max-[860px]:grid-cols-1";

const btnBase = "cursor-pointer rounded-[7px] border font-extrabold";

/** Solid-filled primary button. */
export const primaryBtn = `${btnBase} min-h-[42px] px-[14px] border-transparent bg-solid text-white`;

/** Outlined chip; pass `active` to fill it. */
export const chip = (active?: boolean) =>
  cx(
    btnBase,
    "min-h-[42px] px-[14px]",
    active ? "border-transparent bg-solid text-white" : "border-line-strong bg-white text-ink"
  );

export const eyebrow = "mb-2.5 text-[0.74rem] font-bold uppercase tracking-[0.16em] text-solid-ink";

export const kicker = "text-[0.72rem] font-bold uppercase tracking-[0.14em] text-solid";

/** A panel's descriptive paragraph (the old `.panel > p`). */
export const desc = "max-w-[58ch] leading-[1.55] text-muted";

/** A bordered card surface (the recurring `.panel`). */
export function Panel(props: { class?: string; children: JSX.Element }) {
  return <section class={cx(panelCol, props.class)}>{props.children}</section>;
}

/** Shimmer sweep overlay used by every pending affordance. */
export function Shimmer(props: { active?: boolean }) {
  return <span class={{ "shimmer-overlay": true, on: !!props.active }} aria-hidden="true" />;
}
