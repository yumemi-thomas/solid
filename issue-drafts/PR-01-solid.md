# PR draft — solidjs/solid

**Branch:** `fix/reveal-nested-boundary-scope` (commit `8fff1bf1`, based on `next` @ `a51cac19`)
**Title:** `fix(server): sever reveal scope inside Loading boundaries so only direct slots join a Reveal group`

⚠️ **Land with (or after) the dom-expressions runtime fix** `ryansolid/dom-expressions#<PR>` and bump the `@dom-expressions/runtime` dependency — without it, this change trades the hostage delay for silent content loss when a nested boundary resolves before its group releases (details in the issue's Part 2).

---

## Body

Fixes #<ISSUE-01>.

### Problem

The client severs the reveal scope inside every boundary (`createCollectionBoundary` nulls `RevealControllerContext` on the boundary's owner), so a `<Reveal>` group contains its **direct** `<Loading>` slots only. The server never did: `RevealGroupContext` leaked through boundary scopes, so a `<Loading>` nested inside another slot's content registered as a sibling slot. Consequences:

- `order="together"`: one deeply nested slow boundary held every ready direct slot hostage (the issue's repro: two direct slots ready at ~40ms stay hidden until a nested boundary resolves at ~80ms, and the group's `$dfj` carries three keys instead of two).
- sync `renderToString` + `collapsed`: a nested pending boundary consumed the collapsed frontier slot, so the first direct pending slot's fallback was collapsed to nothing.

### Fix

`packages/solid/src/server/hydration.ts` — sever `RevealGroupContext` (gated on a group actually being present, mirroring the client's `_revealUsed` gate):

1. on the **children owner** — only direct descendants of `<Reveal>` register into the group; survives retry discovery since `disposeOwner(o, false)` keeps `_context`;
2. on the **fallback owner** — deliberately stronger than the client: a client boundary inside a fallback registers into the ancestor group but *unregisters when the fallback is disposed*, so it can never delay the group past its own slot's readiness. The server group has no unregister, so enrolling it would hold `together` activation hostage on content the activation itself replaces.

The boundary still registers *itself* (the group is read from the parent scope before severing).

### Tests

`packages/solid/test/server/reveal-ssr.spec.ts` (+3, each verified red at `next` HEAD / green with the fix):

1. streaming `together` + nested boundary in a slot's children — nested fragment registers without `revealGroup`, the group releases with exactly the direct keys while the nested one is still pending, nested settles independently afterward
2. streaming `together` + boundary inside a direct slot's **fallback** — does not join the group
3. sync collapsed — a nested pending boundary no longer consumes the collapsed frontier slot

Full `packages/solid` suite green. DOM-level replay evidence for the pairing requirement (real streams, stock vs queued runtime, all resolve-order permutations incl. plain nested `Loading` without `Reveal`) is in the issue.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
