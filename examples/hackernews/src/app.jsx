// The client side. Note what ISN'T here: no server-component API. `dynamic`
// over a server-function call is the whole surface — the call resolves to a
// stable component, refetches morph the boundary in place, and everything
// the client owns inside it (collapse toggles, the draft note) survives
// navigation.
import { createSignal, Loading } from "solid-js";
import { dynamic } from "@solidjs/web";
import { getStoryList, getStory } from "./data.jsx";

/**
 * A client component wrapping server-owned comment bodies. Its state is the
 * demo: per-comment collapse overrides a global toggle, none of it ever
 * appears in a request, and it survives story navigation because the same
 * entity (`$key`) keeps the same wrapper.
 */
function CollapsibleComment(props) {
  const [local, setLocal] = createSignal(null);
  const collapsed = () => local() ?? props.collapsed;
  return (
    <div class={"comment" + (collapsed() ? " collapsed" : "")}>
      <button class="toggle" onClick={() => setLocal(!collapsed())}>
        {collapsed() ? "[+]" : "[–]"}
      </button>
      {props.children}
    </div>
  );
}

/** Client-only, persists across every story: try typing, then navigating. */
function DraftNote() {
  return (
    <div class="draft">
      <input placeholder="draft a reply — it survives navigation" />
    </div>
  );
}

// Module scope: navigation state is wired OUTSIDE the component tree (see
// entry-client.jsx) so hydration id parity is untouched by client-only code.
export const [storyId, setStoryId] = createSignal(1);

export function App() {
  const [collapseAll, setCollapseAll] = createSignal(false);

  // The source is tracked: changing storyId re-calls the server function
  // (once — the in-flight call rides out suspended re-reads). Every
  // response for this call site resolves to the SAME component reference,
  // so nothing remounts — the stream morphs the boundary underneath.
  const Story = dynamic(() => getStory(storyId()));
  // The nav is a server component too — its anchors are plain server
  // content. Navigation is DELEGATED (the router contract): one document
  // listener, no per-anchor handlers, nothing about the list serialized.
  const StoryList = dynamic(() => getStoryList());

  return (
    <div class="layout">
      <nav>
        <Loading fallback={<p class="loading">loading…</p>}>
          <StoryList
            children={() => (
              <label class="collapse-all">
                <input type="checkbox" onChange={e => setCollapseAll(e.currentTarget.checked)} />
                collapse new comments
              </label>
            )}
          />
        </Loading>
      </nav>
      <main>
        <Loading fallback={<p class="loading">loading story…</p>}>
          <Story
            comment={p => (
              <CollapsibleComment collapsed={collapseAll()}>{p.children}</CollapsibleComment>
            )}
            children={() => <DraftNote />}
          />
        </Loading>
      </main>
    </div>
  );
}
