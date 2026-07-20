// The server side of the app. Everything in this module stays on the
// server: the client build replaces the two exported functions with
// reference proxies and strips the rest — grep dist/client.js for any
// comment text below and you will find nothing.
import { Loading, createMemo } from "solid-js";

// The "database" — HN-shaped seed data, nested replies included.
const STORIES = [
  {
    id: 1,
    title: "Solid Server Components: lakes, not islands",
    by: "rcarniato",
    points: 512,
    comments: [
      {
        id: "c1",
        by: "pikachu",
        text: "View-source and every comment appears exactly once. No hydration blob?",
        replies: [
          {
            id: "c2",
            by: "rcarniato",
            text: "None. The HTML is the data — the client wraps it without re-rendering it.",
            replies: [
              {
                id: "c3",
                by: "pikachu",
                text: "So collapsing threads is client state the server never sees.",
                replies: []
              }
            ]
          }
        ]
      },
      {
        id: "c4",
        by: "grace",
        text: "The morph kept my half-typed reply alive across a navigation. Nice.",
        replies: []
      }
    ]
  },
  {
    id: 2,
    title: "The native JSX compiler now runs the use-server directive pass",
    by: "oxc-fan",
    points: 274,
    comments: [
      {
        id: "c5",
        by: "grace",
        text: "This example builds with a ~30 line esbuild plugin. No Vite anywhere.",
        replies: [
          {
            id: "c6",
            by: "linus",
            text: "And the server function ids hash the same on both builds — same source, same root.",
            replies: []
          }
        ]
      }
    ]
  },
  {
    id: 3,
    title: "Show HN: my client bundle costs ~5KB to stream server components",
    by: "byte-counter",
    points: 128,
    comments: [
      {
        id: "c7",
        by: "skeptic",
        text: "Smaller than micromorph for the reconciler slice? CI-enforced? OK then.",
        replies: []
      }
    ]
  }
];

const wait = ms => new Promise(r => setTimeout(r, ms));
const countAll = cs => cs.reduce((n, c) => n + 1 + countAll(c.replies), 0);

/** Plain data out of a server function behaves exactly as before. */
export async function getStories() {
  "use server";
  return STORIES.map(({ id, title, by, points, comments }) => ({
    id,
    title,
    by,
    points,
    count: countAll(comments)
  }));
}

/**
 * Returning a function makes it a server component. The function's
 * ARGUMENTS are the server's inputs; the returned component's PROPS are
 * client positions — holes the client fills that never travel here.
 */
export async function getStory(id) {
  "use server";
  const story = STORIES.find(s => s.id === Number(id));
  if (!story) throw new Error(`No story ${id}`);
  return props => (
    <article>
      <h1>{story.title}</h1>
      <p class="meta">
        {story.points} points by {story.by} · {countAll(story.comments)} comments
      </p>
      <Loading fallback={<p class="loading">loading comments…</p>}>
        <CommentSection story={story} comment={props.comment} />
      </Loading>
      <footer>{props.children}</footer>
    </article>
  );
}

/** Async server content: the shell streams first, comments reveal later. */
function CommentSection(props) {
  const ready = createMemo(async () => {
    await wait(400);
    return true;
  });
  return (
    <section class="comments">
      {ready() && props.story.comments.map(c => renderComment(c, props.comment))}
    </section>
  );
}

/**
 * Recursive single-copy composition: each comment's body is server JSX
 * passed INTO a client position — it streams as a nested region (html
 * once, zero data records) that the client wrapper wraps without touching.
 * `$key` names the occurrence by entity so wrapper state follows the
 * comment across refetches.
 */
function renderComment(c, comment) {
  return comment({
    $key: c.id,
    cid: c.id,
    children: (
      <div class="body">
        <p>
          <b>{c.by}</b> {c.text}
        </p>
        <div class="replies">{c.replies.map(r => renderComment(r, comment))}</div>
      </div>
    )
  });
}
