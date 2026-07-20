# Frame News — Solid Server Components

A HN-shaped app demonstrating **Solid Server Components** end to end over
real HTTP, with **no Vite**: the native `@dom-expressions/compiler` runs the
`"use server"` directive pass and both JSX targets through the small esbuild
plugin in [build.mjs](./build.mjs).

```sh
pnpm build   # compile + bundle client and server (node build.mjs)
pnpm start   # http://localhost:3003        (node server.mjs)
```

## What to look at

**The wire.** Open devtools → network, click a story, inspect the `/_server`
response. The server function returned a *function*, so the response is a
frame stream: the story renders as HTML chunks, streamed (the shell flushes
immediately; the comments fragment arrives ~400ms later and reveals in
place). Now run the acceptance test this architecture is built around —
**search the response for any comment's text: it appears exactly once.**
There are no serialized component trees and no hydration data for server
content; the only data records are per-occurrence primitives (`cid`) and
fragment bookkeeping.

**The client bundle.** Grep `dist/client.js` for any story title or comment
text — nothing. The client build replaced the server functions with
reference proxies and stripped the server-component JSX entirely
([src/data.jsx](./src/data.jsx) never reaches the browser).

**Client state across navigations.** Type into the draft box, collapse a
comment, then click another story. The response morphs the same boundary in
place: the draft keeps its text (same DOM node), and none of that state ever
appears in a request — requests carry the story id and nothing else. Toggle
"collapse new comments" and navigate: a client-only signal affects every
future story the server knows nothing about.

## How it's wired

- [src/data.jsx](./src/data.jsx) — the server side. `getStory` says
  `"use server"` and **returns a function: that makes it a server
  component.** Its arguments are the server's inputs; the returned
  component's props are client positions. Comment bodies are server JSX
  passed *into* a client position (`props.comment({ $key, cid, children })`)
  — they stream as nested regions, HTML once, wrapped by the client without
  re-rendering.
- [src/app.jsx](./src/app.jsx) — the client side. There is no
  server-component API: `dynamic(() => getStory(storyId()))` is the whole
  surface. Every response for the call site resolves to the same stable
  component, so nothing remounts — the stream morphs the boundary
  underneath. (The `createMemo` wrapper dedupes the in-flight call, the
  role `query` plays in a router app.)
- [src/entry-client.jsx](./src/entry-client.jsx) — one line of wiring:
  `installServerComponents()`.
- [src/entry-server.jsx](./src/entry-server.jsx) — one handler
  (`handleServerFunctionRequest`) with one hook (`frameTransformResult`).
  A server function returning data behaves exactly as before — the stories
  list in the nav rides the same endpoint as plain serialized data.
- [server.mjs](./server.mjs) — a plain node http server; the frame chunks
  stream through it as the server renders.

This example intentionally boots as a client-rendered shell (the document
SSR + hydration-adoption path is exercised in the solid-web test suite);
the wire and state guarantees above are the architecture's headline and
they're all observable here.
