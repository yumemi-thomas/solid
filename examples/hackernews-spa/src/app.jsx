// The client side of the SSR-SPA baseline: the same UI as the
// server-components example, but every template lives HERE — the comment
// tree renders client-side from JSON, so all of these components (and the
// data that feeds them) must ship to the browser for hydration.
import { createMemo, createSignal, Loading } from "solid-js";
import { getStories, getStory } from "./data.jsx";

const countAll = cs => cs.reduce((n, c) => n + 1 + countAll(c.replies), 0);

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

function Comment(props) {
  return (
    <CollapsibleComment collapsed={props.collapsed()}>
      <div class="body">
        <p>
          <b>{props.comment.by}</b> {props.comment.text}
        </p>
        <div class="replies">
          {props.comment.replies.map(r => (
            <Comment comment={r} collapsed={props.collapsed} />
          ))}
        </div>
      </div>
    </CollapsibleComment>
  );
}

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
  const story = createMemo(async () => getStory(storyId()));

  return (
    <div class="layout">
      <nav>
        <h2>Frame News (SPA)</h2>
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
          <article>
            <h1>{story().title}</h1>
            <p class="meta">
              {story().points} points by {story().by} · {countAll(story().comments)} comments
            </p>
            <section class="comments">
              {story().comments.map(c => (
                <Comment comment={c} collapsed={collapseAll} />
              ))}
            </section>
            <footer>
              <DraftNote />
            </footer>
          </article>
        </Loading>
      </main>
    </div>
  );
}
