---
"@solidjs/web": patch
---

**Experimental — `@solidjs/web/frames`: server components.** Shipping as
an experimental preview alongside Solid 2.0: the subpath, its API, and the
underlying wire format are NOT covered by 2.0's stability guarantees and
may change between prereleases. Expect a separate stabilization
announcement.

There is deliberately no new component API. A server component is a
function returned from a server function, and `dynamic` is how you use it:

```tsx
const getStory = /* "use server" fn returning (props) => JSX */;

function StoryPage(props) {
  const Story = dynamic(() => getStory(props.storyId));
  return (
    <Story comment={(p) => <CollapsibleComment cid={p.cid}>{p.children}</CollapsibleComment>}>
      <ShareBar />
    </Story>
  );
}
```

Server content streams as HTML and morphs in place across refetches —
client components inside it (and their state: focus, inputs, toggles)
survive navigation. Nothing ships twice: no serialized component trees, no
hydration data for server content, and at t = 0 the server-rendered
document is adopted (zero requests at boot; wrappers claim their
server-rendered DOM by hydration key). Content the client didn't render at
SSR (e.g. collapsed threads) ships once as data and mounts later with zero
network.

Surface:

- client: `installServerComponents()` (call once in the client entry),
  `getFrameHost`, and the frame/transport primitives routers build on
  (`applyFrameResponse`, `FRAME_APPLIED_EVENT`, `adoptFrameRange`,
  `createServerComponentHandler`). Server-component anchors/forms
  participate in the element-claim contract, so router link state works on
  server content unchanged.
- server (`@solidjs/web/frames/server`): `frameTransformResult` /
  `frameTransformDirectResult` — install on the server-function handler
  and document SSR respectively — plus `renderServerComponent`,
  `renderToFrameStream`, `serverComponentResponse`, `createFrameSink`, and
  the document-shell pieces (`ServerComponentPlugin`,
  `SERVER_COMPONENT_BOOTSTRAP`).

See `examples/hackernews` (and its SSR-SPA twin, the measured comparison)
and dom-expressions' `docs/server-components.md`.
