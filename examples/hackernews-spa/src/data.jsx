// The SSR-SPA baseline's data layer: identical seed to the server-components
// example, but the server functions return PLAIN DATA — the client renders
// it, which is what puts every piece of content on the wire twice at initial
// load (once as HTML, once in the hydration data that produced it).
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

/** Data out; the client owns every template. */
export async function getStory(id) {
  "use server";
  const story = STORIES.find(s => s.id === Number(id));
  if (!story) throw new Error(`No story ${id}`);
  await wait(400); // parity with the SC example's comments delay
  return story;
}
