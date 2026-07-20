// The client side. Note what ISN'T here: no server-component API. `dynamic`
// over a server-function call is the whole surface — the call resolves to a
// stable component, refetches morph the boundary in place, and everything
// the client owns inside it (collapse toggles, the draft note) survives
// navigation.
import { createMemo, createSignal, Loading } from "solid-js";
import { dynamic } from "@solidjs/web";
import { getStories, getStory } from "./data.jsx";

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

export function App() {
  const [storyId, setStoryId] = createSignal(1);
  const [collapseAll, setCollapseAll] = createSignal(false);
  const stories = createMemo(async () => getStories());

  // The call is tracked: changing storyId re-calls the server function.
  // Every response for this call site resolves to the SAME component
  // reference, so nothing remounts — the stream morphs the boundary. The
  // createMemo wrapper dedupes the in-flight call (one fetch per
  // navigation, however many times the suspended tree re-reads it) — the
  // same role `query` plays in a router app.
  const story = createMemo(() => getStory(storyId()));
  const Story = dynamic(() => story());

  return (
    <div class="layout">
      <nav>
        <h2>Frame News</h2>
        <Loading fallback={<p class="loading">loading…</p>}>
          <ul>
            {stories().map(s => (
              <li class={s.id === storyId() ? "active" : ""}>
                <a onClick={() => setStoryId(s.id)}>{s.title}</a>
                <span class="meta">
                  {s.points} points · {s.count} comments
                </span>
              </li>
            ))}
          </ul>
        </Loading>
        <label class="collapse-all">
          <input type="checkbox" onChange={e => setCollapseAll(e.currentTarget.checked)} />
          collapse new comments
        </label>
      </nav>
      <main>
        <Loading fallback={<p class="loading">loading story…</p>}>
          <Story
            comment={p => (
              <CollapsibleComment collapsed={collapseAll()}>{p.children}</CollapsibleComment>
            )}
          >
            <DraftNote />
          </Story>
        </Loading>
      </main>
    </div>
  );
}
