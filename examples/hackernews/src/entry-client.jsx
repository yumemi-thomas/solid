import { createRenderEffect } from "solid-js";
import { hydrate } from "@solidjs/web";
// The only frames wiring a client needs: install the server-component
// transport policy once. (Explicit call — @solidjs/web is sideEffects:false
// and bundlers would drop a bare import.)
import { installServerComponents } from "@solidjs/web/frames";
import { App, setStoryId, storyId } from "./app.jsx";

installServerComponents();
hydrate(() => <App />, document.getElementById("app"));

// Navigation wiring lives OUTSIDE the component tree (no hydration ids
// consumed): one document-level delegated listener — the router <a>
// contract — plus the active-state affordance reflected onto the
// server-owned anchors.
document.addEventListener("click", e => {
  const a = e.target instanceof Element && e.target.closest("a[data-story]");
  if (a) setStoryId(Number(a.getAttribute("data-story")));
});
createRenderEffect(
  () => storyId(),
  id => {
    document.querySelectorAll("nav li").forEach(li => {
      const a = li.querySelector("a[data-story]");
      li.classList.toggle("active", !!a && Number(a.getAttribute("data-story")) === id);
    });
  }
);
