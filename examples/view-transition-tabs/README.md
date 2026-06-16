# ViewTransition workbench

A demo gallery for Solid 2.0's native **View Transitions** on the `@solidjs/web`
runtime — plus the lifecycle primitives that pair with them (`Activity`,
`UnstableKeepAlive`, `Reveal`, `Loading`, `createOptimisticStore`).

Each tab is a self-contained, router-free demo. A small HUD (the chip top-right
and the in-panel monitor) narrates the live transition lifecycle — `capture →
animate → finished` — by patching `document.startViewTransition` once, without
touching any demo's code.

## Running

From this folder (the Vite config aliases `@solidjs/web` / `solid-js` straight to
the repo's `packages/*/src`, so no prebuild is needed):

```bash
pnpm dev      # or: npm run dev
# → http://127.0.0.1:5174
```

`pnpm typecheck` and `pnpm build` are also available.

## The demos

| Tab | What it shows | Key APIs |
| --- | --- | --- |
| **Shared Card** | A compact card and the detail panel share one `view-transition-name`, so selecting a card is treated as a **shared-element morph**, not a separate exit + enter. | `<ViewTransition share>` |
| **Async Loading** | A `Loading` boundary awaited *inside* `startViewTransition`: the browser holds the old card's snapshot while new data settles, then cross-fades old → resolved as one animation — no spinner, no layout jump. | `<ViewTransition>`, `Loading`, async `startViewTransition` |
| **Reveal Group** | Two async lanes resolve at *different* speeds but live in one `Reveal order="together"` group, so the fast one waits and both swap in a single frame. | `Reveal`, `Loading`, `<ViewTransition>` |
| **Async Todo** | An async-react–style lessons app: optimistic toggles, a sliding filter pill, debounced search, and a live network debugger. The list/summary reveal together while the page stays interactive. | `createOptimisticStore`, `action`, `isPending`/`latest`, `refresh`, `Reveal` |
| **List Reorder** | Each item keeps a stable `view-transition-name`, so reordering animates as **`update`** (position) transitions. | `<ViewTransition update>`, `addTransitionType` |
| **Activity Cache** | The inactive pane is hidden with `Activity mode="hidden"` — kept mounted (state + DOM preserved) while its **effects pause** (the live timer stops while hidden and resumes on show, React parity). | `Activity`, `<ViewTransition>` |
| **Tabbed Forms** | A settings panel (Profile / Appearance / Notifications) where switching cross-fades **and** each pane's form state survives, because every pane stays mounted under `Activity`. The real-world application of the Activity Cache mechanism. | `Activity`, `<ViewTransition>`, `startViewTransition` |
| **Hide & Show** | A counter that animates **out (`exit`)** and back **in (`enter`)** when toggled, wrapped in `Activity` so it is only hidden — never unmounted — and the count survives every cycle. | `<ViewTransition enter exit>`, `Activity` |
| **Directional Nav** | A 4-step "router": **Next** slides the new screen in from the right while the old exits left; **Back** mirrors it. Direction is just a transition type the `enter`/`exit` classes are keyed on. | `addTransitionType("forward"/"back")`, `<ViewTransition enter exit>` |
| **Add & Remove** | List rows animate **in** on add and **out** on remove, while the remaining rows slide to their new positions as a single **`update`** transition. | `<ViewTransition enter exit update>` |
| **Keep Alive** | During a gesture, `UnstableKeepAlive` retains the outgoing screen so a *cancelled* swipe-back restores the exact same live instance — a running timer (its effect never paused), caret, and scroll — versus a keyed `<Show>`, which rebuilds from scratch. | `UnstableKeepAlive`, `startGestureTransition` |

### `Activity` vs `UnstableKeepAlive` (when state must survive)

- **`Activity`** keeps a subtree mounted across *any* switch and **pauses its effects** while hidden. Reach for it for warm, fixed panes (Activity Cache, Tabbed Forms, Hide & Show).
- **`UnstableKeepAlive`** is a keyed switch that retains the outgoing branch **only during an in-flight gesture** (then disposes it), preserving live node identity so a cancel restores it exactly. Reach for it for "swipe to a new screen, then change your mind" (Keep Alive).

## Layout of the source

```
src/
  main.tsx              app shell, tab nav, mount
  ui.tsx                shared Tailwind primitives (Panel, buttons, helpers)
  vt-monitor.tsx        transition-lifecycle signals + HUD
  styles.css            the irreducible global CSS — @theme tokens, the
                        ::view-transition-* pseudo-element rules + keyframes,
                        view-transition-class maps, and the tab-switch name
                        overrides (everything else is Tailwind in the components)
  demos/
    SharedCardDemo.tsx  AsyncLoadingDemo.tsx  RevealDemo.tsx
    ReorderDemo.tsx     ActivityDemo.tsx      SettingsTabsDemo.tsx
    HideShowDemo.tsx    DirectionalNavDemo.tsx  AddRemoveDemo.tsx
    GestureScrubDemo.tsx
    todo/
      TodoDemo.tsx      server.ts (fake API + network log)  parts.tsx
```

> **Why some styling is still hand-written CSS:** Tailwind utilities can't express
> the `::view-transition-old/new/group` pseudo-elements, their `@keyframes`, the
> `view-transition-class` maps, or `:root:active-view-transition-type(tab) …`
> overrides — so those live in `styles.css`. Component look-and-feel is otherwise
> Tailwind in the markup.
