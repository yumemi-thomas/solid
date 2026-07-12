# Bug Hunt — Solid 2.0 (unreported findings, wave 1)

Originally hunted 2026-07-02 at `next` `0e8672ab` (beta.15 + post-release fixes); 20 findings,
each with a runnable repro. Re-verified 2026-07-09 against `next` `ef4d53ea` (2.0.0-beta.16 +
4 commits), then **re-verified 2026-07-10 against `next` `a99d6c87` (2.0.0-beta.16 + 7 commits)**,
and again **2026-07-11 against `next` `a51cac19` (2.0.0-beta.17)** — findings 17 and 20 still reproduce.
This file now tracks only the findings that still reproduce; solved findings are recorded in the
ledger below and their repro tests / issue drafts have been removed.

## Resolved (repro + draft removed)

| # | What | Resolution |
|---|------|------------|
| 1 | reconcile() doesn't notify per-index nodes on array shrink | #2823 → PR #2824 |
| 2 | reconcile unwrap() leaks raw Signal objects | #2825 → PR #2826 |
| 3 | repeat() disjoint `from` windows leak/mis-map rows | **beta.16 — #2853 → PR #2854** |
| 4 | throwing `equals` comparator kills all reactivity | #2837 |
| 5 | EffectBundle `error` handler & effect-phase throws | #2839/#2840 — pinned as intended (effect-phase throws are the error arm of the effect phase, not routed to compute handler) |
| 10 | `style` object binding mutates user objects | dom-expressions #534 |
| 11 | outer root's delegated handlers skipped for nested-root events | #2832 |
| 12 | `getOwnPropertyDescriptor(store,k).value` stale | #2835 → PR #2836 |
| 13 | `snapshot()` shrinks array length on deleted trailing index | **beta.16 — #2846 → PR #2848** |
| 14 | `reconcile()` never notifies symbol-keyed nodes | **beta.16 — #2851 → PR #2852** |
| 15 | compute-phase errors reach EffectBundle handler as `StatusError` | **beta.16 — #2840 / 57b92a1c (unwrap StatusError before the handler)** |
| 6 | SSR falsy async rejection swallowed — children render as resolved | **beta.16+7 — #2857 → 9b883e0d** |
| 7 | SSR non-Promise thenables render empty instead of being awaited | **beta.16+7 — #2858 → 9b883e0d** |
| 8 | `lazy()` inside `<NoHydration>` silently renders nothing | **beta.16+7 — #2859 → 4cc6113e** |
| 9 | `_currentBoundaryId` leaks after a Loading boundary → later root `lazy()` never hydrates | **beta.16+7 — #2860 → 928ba28f** |
| 16 | `createReaction` re-arm accumulates live arms instead of replacing deps | **beta.16+7 — #2861 → 40d13a9e (+ a99d6c87 type import)** |
| 18 | `Portal` leaks an empty text node per instance | #2833 |
| 19 | adjacent expression slots destroy each other's nodes | #2830 |

Also resolved separately: **#2829 / latest()+isPending()** (all three claims plus the
isPending(latest) infinite scheduler loop) — fixed by the #2838 write-driven companion
redesign + #2844. Repros removed.

## Still open (repro in place, fails while the bug exists)

Run: `cd packages/solid-web && pnpm vitest run --config vite.config.server.mjs test/server/hunt-reveal-nested-loading.spec.tsx`
(SSR), `pnpm vitest run test/hunt-render-nonempty.spec.tsx` (client).

### 17. SSR: nested Loading registers into the ancestor `<Reveal>` group — `order="together"` waits on non-direct descendants
Client clears the reveal context per boundary (`boundaries.ts:388`), server (`src/server/hydration.ts:68-217`) doesn't.
- Repro: `packages/solid-web/test/server/hunt-reveal-nested-loading.spec.tsx`. Draft: `issue-drafts/01-reveal-nested-loading-grouping.md`.

### 20. Client: disposing a root rendered into a non-empty container wipes pre-existing content
Append mode is intentional at client.js:71, but the disposer does `element.textContent = ""` at client.js:84-88, wiping content that was in the container before the render.
- Repro: `packages/solid-web/test/hunt-render-nonempty.spec.tsx`. Draft: `issue-drafts/02-dispose-wipes-preexisting-content.md`.

## Verified-working (negative results)
Async memo inside Errored fallback (no refetch loop — #2809 fix holds); Loading fallback throwing → caught by surrounding Errored; per-row async memos in `<For>` (one fetch per row); `</script>`/`<!--` escaping in serialized data (seroval escapes correctly); throwing *effects* recover (#2761/#2762 fixes hold); boolean-attribute presence-only semantics (documented 2.0 behavior); For duplicates/reorders, Dynamic tag swaps, spread prop removal, pre-hydration event replay — all correct.
