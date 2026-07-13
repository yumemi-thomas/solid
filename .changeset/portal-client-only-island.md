---
"@solidjs/web": patch
---

Portal no longer crashes SSR — portals are client-only islands (#2876)

The server renders nothing for a `<Portal>`: children are never evaluated, no
async starts, and nothing is serialized. Throwing (as earlier betas did) was
caught by ancestor `Errored` boundaries and baked the error fallback into the
streamed HTML for trees that render fine client-side.

Both sides advance the parent's child-id counter by exactly one slot — the
client scopes the portal's internals under a dedicated owner and the server
consumes the matching id — so hydration ids for siblings after a portal stay
aligned.

On the client, the portal's content memo and effects are gated with
`ssrSource: "client"`, so under hydration the children render fresh in the
settle flush — no evaluation during the hydration walk, no effect-type
switching (the 1.x timing hack). Async discovered inside a portal after
settle forwards through already-initialized ancestor boundaries as ordinary
pending status, so nothing regresses to a fallback; the portal simply attaches
when its content is ready.
