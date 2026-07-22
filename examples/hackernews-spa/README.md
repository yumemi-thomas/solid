# Frame News — the SSR-SPA baseline

The comparison twin of [../hackernews](../hackernews): the **same app** —
same seed data, same visuals, same build pipeline, same node server — built
the classic way: server functions return JSON, client components render
everything, standard document SSR with hydration data.

```sh
pnpm build && pnpm start   # http://localhost:3004
```

It's a *good* baseline: fine-grained hydration, zero requests at boot
(serialized data resume), one JSON fetch per navigation, client state
survives navigation. The difference is structural, not quality: **run
`grep -c` for any comment's text against `view-source:` of both apps** —
this one carries every piece of content twice (once as HTML, once in the
hydration data that produced it), and must ship every content component to
the browser to hydrate. The server-components twin carries content once
and ships only the interactive wrappers. See the measured comparison in
[../hackernews/README.md](../hackernews/README.md).
