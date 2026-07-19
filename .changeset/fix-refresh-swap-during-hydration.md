---
"solid-js": patch
---

Fix streamed `<Loading>` boundaries duplicating resolved content when a Solid Refresh HMR update lands while hydration is still in progress (#2919). A hot swap disposes the mounted component; if a streamed boundary's `$df` reveal had already swapped its settled content into the DOM but the boundary had not yet resumed to claim it, disposal could no longer find the fragment markers and the revealed server nodes leaked as duplicate content. The refresh runtime now defers registry patching until the hydration pass settles (via the internal `sharedConfig.onHydrationEnd` hook), letting the old component finish claiming its server-rendered DOM before the swap reconciles it; patches outside a hydration pass still apply synchronously.
