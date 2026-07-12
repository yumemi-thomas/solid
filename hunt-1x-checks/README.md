# Solid 1.x comparison checks for the 2.0 bug-hunt findings

Standalone vitest harness that verifies, against **solid-js 1.9.14**, whether each
unfiled finding from `HUNT-2.0-beta.15.md` is a regression from 1.x or a pre-existing
behavior. Results are recorded in the `## Does this exist in Solid 1.x?` section of
each file in `issue-drafts/`.

This directory is intentionally **not** part of the workspace (no pnpm-workspace
entry) — it installs published packages from npm.

## Run

```bash
cd hunt-1x-checks
npm install            # installs solid-js@1, vitest, jsdom, vite-plugin-solid
npx vitest run --config vite.config.client.mjs   # client/reactivity/store checks
npx vitest run --config vite.config.server.mjs   # SSR checks
```

Tests assert the **correct** behavior. A passing check means 1.x is correct there
(so the 2.0 finding is a regression); a failing check means the problem predates 2.0
(the assertion output shows the 1.x behavior).

## Results at solid-js 1.9.14 (2026-07-05)

| Check | Finding | 1.x verdict |
| --- | --- | --- |
| `checks/04-throwing-equals` | 4 throwing `equals` kills scheduler | **PASS** → 2.0 regression (1.x throws at call site, recovers) |
| `server-checks/06-falsy-rejection` | 6 SSR falsy rejection swallowed | **PASS** → 2.0 regression |
| `server-checks/07-thenable` | 7 SSR thenable crash | **PASS** → 2.0 regression |
| `server-checks/08-nohydration-lazy` | 8 lazy in NoHydration empty | **PASS** → 2.0 regression |
| `checks/11-nested-root-delegation` | 11 nested-root delegated events | **PASS** → 2.0 regression |
| `checks/12-descriptor` | 12 descriptor stale value | **PASS** → 2.0 regression |
| `checks/13-unwrap-deleted-index` | 13 snapshot shrinks length | **PASS** → 2.0 regression |
| `checks/14-reconcile-symbol-keys` | 14 reconcile symbol keys | **FAIL** → exists in 1.x too (worse: value not even merged) |
| `checks/16-reaction-rearm` | 16 createReaction re-arm | **PASS** → 2.0 regression |
| `checks/18-portal-leak` | 18 Portal marker leak | **PASS** → 2.0 regression |
| `checks/19-slot-swap` | 19 adjacent-slot node migration | **FAIL** → broken identically in 1.x ("1"/"1end" node destruction) |
| `checks/20-render-dispose` | 20 dispose wipes container | **FAIL** → same wipe in 1.x (`element.textContent = ""`), but 2.0 intentionally supports non-empty containers |

## Wave 2 results (`w2-*` checks, for `HUNT-2.0-beta.15-wave2.md`, at solid-js 1.9.14)

| Check | Wave-2 finding | 1.x verdict |
| --- | --- | --- |
| `checks/w2-store-map-set-date` | 1 Map/Set/Date store values | **PASS** → 2.0 regression |
| `checks/w2-store-reconcile-keyless-leaf` | 2 reconcile keyless leaf | **PASS** → 2.0 regression |
| `checks/w2-store-unwrap-symbol-keys` | 3 snapshot drops symbol keys | **PASS** → 2.0 regression |
| `checks/w2-store-accessor-setter` | 4 accessor-setter write | **FAIL** → 2.0 worse (bypasses setter; 1.x invokes it, both shadow getter) |
| `checks/w2-store-freeze` | 5 `Object.freeze` poisoning | **FAIL** → also broken in 1.x (narrower blast radius) |
| `checks/w2-store-draft-reassign-identity` | 6 draft-reassign identity | **PASS** → 2.0 regression |
| `checks/w2-errorboundary-falsy-rejection` | 9 errored bare-rejection wrapper | **PASS** → 2.0 regression |
| `checks/w2-core-throwing-effect-siblings` | 15 throwing effect drops siblings | **FAIL** → also broken in 1.x |
| `checks/w2-core-map-falsy-fallback` | 16 mapArray falsy fallback | **FAIL** → also broken in 1.x |
| `checks/w2-dom-bound-data-stale` | 17 delegated bound-data stale | inconclusive (1.x handlers bound-once) |
| `checks/w2-dom-bound-array-mutation` | 18 tuple mutation / shared chaining | **FAIL** → also broken in 1.x (event→null) |
| `checks/w2-dom-property-undefined` | 19 property binding renders "undefined" | **FAIL** → also broken in 1.x |
| `checks/w2-dom-fragment-stale` | 20 fragment stranded children | **FAIL** → also broken in 1.x |
| `checks/w2-dom-frozen-component` | 21 dev crash on frozen component | **FAIL** → also broken in 1.x |
| `server-checks/w2-assets-element` | 22 Assets/useAssets element crash | **PASS** → 2.0 regression |
| `server-checks/w2-array-attr-escape` | 23 array-attribute XSS | **FAIL** → also broken in 1.x |
| `server-checks/w2-style-class-separators` | 24/25 style/class leading separator | **FAIL** → also broken in 1.x |

Wave-2 findings 7, 8, 10, 11, 12, 13, 14 are 2.0-only API surface (`resolve()`, writable
async memos, async iterables in memos, the async status/pending system, the pending-node
commit machinery, `Loading`/`Errored` boundaries) — no 1.x counterpart, so no `w2-` check.

---

Findings 3, 5, 9, 15, 17 are 2.0-only APIs (`Repeat`, EffectBundle `error` option,
boundary asset serialization, `StatusError`, `Reveal`) — no 1.x counterpart.
