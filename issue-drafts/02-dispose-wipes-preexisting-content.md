# `render()` into a non-empty container appends, but its disposer wipes the whole container (1.x and 2.0.0-beta.17)

### Describe the bug

`render()` deliberately distinguishes empty from non-empty containers at mount: when `element.firstChild` exists it switches to append mode and leaves the existing children alone (`client.js:71` passes a `null` marker). But the disposer returned by that same `render()` call does `element.textContent = ""`, destroying the pre-existing content along with the rendered tree:

1. `render(() => <span>widget</span>, container)` into a container holding static markup appends correctly — the static markup survives mounting.
2. Calling the returned `dispose()` empties the **whole container**, including the static markup that was there before Solid ever touched it.

This bites libraries that `render()` into a container they don't own — most sharply **embeddable widgets / client-only islands** with a `mount(el)` API, where the host hands over an element that already holds its own content. It is the exact shape [`@astrojs/solid-js`](https://github.com/withastro/astro/blob/main/packages/integrations/solid/src/client.ts) uses for client-only islands — `render(fn, element)` plus calling the returned disposer on `astro:unmount`. Astro dodges the mount-side half by doing `element.innerHTML = ''` before rendering (an explicit acknowledgement that `render()` appends into non-empty containers), but nothing protects the host's content from the disposer's `textContent = ""`.

1.x (verified on 1.9.14) behaves identically — same append-aware mount line, same `textContent = ""` disposer, and no dev warning about the non-empty container — so this is a long-standing inconsistency rather than a 2.0 regression. Reporting it against 2.0 because the mount/dispose asymmetry is now the only thing standing in the way of a fully supported widget-root story (cf. #2775 for a previous 1.x-and-2.0 fix in this area), and because the internal cleanup machinery already draws the correct distinction (see below).

### Your Example Website or App

**StackBlitz:** https://stackblitz.com/edit/df77ujku?file=src%2FApp.jsx

The bug reproduces on published `2.0.0-beta.16` (the linked StackBlitz) and was re-verified locally at `next` `a51cac19` (v2.0.0-beta.17). An embeddable reviews island exposes a `mount(el)` API (`render(fn, el)` + a disposer — the Astro shape) and is mounted into the host's `#reviews` slot, which already holds a heading + summary the host rendered. Click **mount widget** (the island appends after the host's content), then **unmount widget** — the whole `#reviews` slot is blanked, destroying the host's heading + summary, and the status line turns red (it turns green **PASS** if the host content survives).

`index.html` — the host page owns the `#reviews` slot, which already holds a heading + summary before the widget ever mounts:

```html
<div id="root"></div>
<div id="reviews">
  <h3>Customer reviews</h3>
  <p>★ 4.8 average — 24 reviews</p>
</div>
<script type="module" src="/src/index.jsx"></script>
```

`src/App.jsx`:

```jsx
import { createSignal } from "solid-js";
import { render } from "@solidjs/web";

// The embeddable widget (a client-only island).
function ReviewForm() {
  const [stars, setStars] = createSignal(0);
  return <p>Your rating: <button onClick={() => setStars(stars() + 1)}>★ {stars()}</button></p>;
}

// The library's mount API: render into whatever element the host provides and
// return a disposer — exactly like Astro's client:only Solid renderer.
function mountReviewForm(el) {
  return render(() => <ReviewForm />, el);
}

export default function App() {
  const [mounted, setMounted] = createSignal(false);
  const [slotWiped, setSlotWiped] = createSignal(); // undefined until first unmount

  let dispose;
  const slot = () => document.getElementById("reviews");

  function mount() {
    if (dispose) return;
    dispose = mountReviewForm(slot()); // appends after the host's content
    setMounted(true);
  }
  function unmount() {
    dispose?.();
    dispose = undefined;
    setMounted(false);
    setSlotWiped(!slot().querySelector("h3")); // did the host heading survive?
  }

  return (
    <section style={{ "font-family": "system-ui", padding: "16px" }}>
      <h2>Embeddable reviews island mounted into a host slot</h2>
      <button onClick={mount} disabled={mounted()}>mount widget</button>{" "}
      <button onClick={unmount} disabled={!mounted()}>unmount widget</button>
      <p
        style={{
          color: slotWiped() === undefined ? "#666" : slotWiped() ? "#c5221f" : "#137333"
        }}
      >
        {slotWiped() === undefined
          ? "Mount appends the widget after the host's content; unmount should remove only the widget."
          : slotWiped()
            ? "FAIL — unmounting the widget blanked the whole #reviews slot, including the host's heading + summary."
            : "PASS — pre-existing content survived dispose."}
      </p>
    </section>
  );
}
```

### Steps to Reproduce the Bug or Issue

1. Click **mount widget**. The island appends *after* the host's content; `#reviews` is now `<h3>Customer reviews</h3><p>★ 4.8 average…</p><p>Your rating: <button>★ 0</button></p>` (append mode — the host content stays).
2. Click **unmount widget**. The whole `#reviews` slot is blanked — the host's `<h3>` + summary `<p>` that the widget never rendered are gone. On 2.0.0-beta.17 the page shows:

```text
FAIL — unmounting the widget blanked the whole #reviews slot, including the host's heading + summary.
```

### Expected behavior

Unmounting removes only the nodes the widget's `render()` inserted; the host's `<h3>` + summary stay in `#reviews`:

```text
PASS — pre-existing content survived dispose.
```

### Screenshots or Videos

_No response_

### Platform

- OS: macOS
- Browser: Chrome
- Version: 2.0.0-beta.17 (re-verified at `next` @ `a51cac19`; also reproduces on solid-js 1.9.14)

### Additional context

Root cause in `render()` in `node_modules/dom-expressions/src/client.js:66-88` (source repo: ryansolid/dom-expressions, `src/client.js`). Mounting is careful about existing children, but the disposer is not:

```js
insert(
  element,
  () => tree,
  element.firstChild ? null : undefined,   // client.js:71 — append mode for non-empty containers
  init,
  options.insertOptions
);
...
return () => {
  disposer();
  unregisterDelegatedRoot(element);
  element.textContent = "";                // client.js:87 — wipes pre-existing content too
};
```

(`insert`'s own cleanup path has the same distinction internally: `cleanChildren` at `client.js:859` only does the `textContent = ""` fast-path when `marker === undefined`, i.e. when the root owned the whole container.)

Suggested fix direction: only use the `textContent = ""` fast-path when the container was empty at mount (the same `element.firstChild` condition already computed on line 71); in append mode, remove just the nodes the root inserted — which `insert`'s current-value tracking already knows — e.g. run the disposer and then remove the tracked current nodes instead of clearing the container.

## Does this exist in Solid 1.x?

**Same behavior in 1.x — but 2.0's own docs make it a bug now.** Verified against solid-js **1.9.14**: 1.x's `render()` disposer also ends with `element.textContent = ""`, wiping pre-existing container content (same append-aware mount line, and no dev warning in either version's dev build). The difference is the documented contract: 1.x's docs tell you to mount into an empty element, so the wipe is defensible there. 2.0's docs explicitly bless a non-empty mount container — the dev-diagnostics guide describes the container showing "its existing content, e.g. a static shell" while async mounts settle, and the DOM guide frames render roots as "embedded in a larger page". Under that contract, a disposer that blanks the host region — including the static shell the docs just endorsed — is inconsistent with 2.0's own story rather than inherited-and-fine.
