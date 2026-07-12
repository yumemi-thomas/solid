# Issue-draft triage — severity, fix effort, implementation order

State: 36 drafts (37 findings) at `next` `a51cac19` (**2.0.0-beta.17**), 2026-07-11.
All drafts are StackBlitz-ready (paste-in App.tsx or vite-node server script); live links exist for `01` and `02`.
Removed as fixed in beta.17: `10` (#2866 → PR #2867), `11` (#2868 → PR #2870), `12` (#2869 → PR #2870),
`24` (dom-expressions #541, shipped in 0.50.0-next.17), `36` (PR #2863, external hunt).

**Severity**: 🔴 critical/P1 · 🟠 P2 · 🟡 low/long-standing — **Fix**: ✅ easy · ⚙️ moderate · 🧠 hard/design

**Order** = suggested implementation order (1 = first). Rationale: easy quick wins clustered
by file/area (issue+PR pairs) → P1 regressions → hydration data-loss → moderate semantics → design-heavy
last (those should be filed as issues only, not PRs — the maintainer historically re-implements at his
preferred layer). Bundled near-duplicates share adjacent slots.

## Store & projections

| Order | Draft | Sev | Fix | Notes |
|---|---|---|---|---|
| 19 | `03-store-map-set-date-crash.md` | 🔴 | ⚙️ | Regression; proxy passed as `Reflect.get` receiver → internal-slot crash; bind built-ins to raw target (pattern at `store.ts:578`) |
| 20 | `04-reconcile-keyless-leaf.md` | 🔴 | ⚙️ | Regression; keyless leaves get no `notifySelf` — implement together with `39` (same notify-gap family) |
| 6 | `05-snapshot-drops-symbol-keys.md` | 🟠 | ✅ | Residual gap of #2769 — apply the same `ownEnumerableKeys` fix to `getKeys()`; pair with `40` |
| 34 | `06-accessor-setter-shadowed.md` | 🟠 | ⚙️ | Set trap never consults descriptor while get trap honors accessors; cross-ref #2835 |
| 36 | `07-freeze-store-poison.md` | 🟡 | ⚙️ | Also 1.x-ish; missing `preventExtensions`/`isExtensible` traps; semantics decision (reject loudly vs support) |
| 38 | `08-draft-reassign-identity.md` | 🔴 | 🧠 | Regression; `unwrapStoreValue` clones overridden subtrees — identity semantics = design discussion; file issue, no PR |
| 30 | `33-projection-draft-identity.md` | 🟠 | ⚙️ | Fresh nested proxy per read breaks `includes()`; fix = cache node proxies like the store proxy does |
| 8 | `34-empty-string-projection-key.md` | 🟡 | ✅ | One-character fix: `\|\|` → `??` at `projection.ts:54` |
| 9 | `35-projection-defineproperty-noop.md` | 🟡 | ✅ | Silent success is the bug; returning `false`/throwing is enough |
| 32 | `37-array-length-validation.md` | 🟠 | ⚙️ | Regression; validate via `new Array(len)` semantics; repro codes the full matrix incl. snapshot RangeError. (Sibling `36` canonical-index bug fixed in beta.17, PR #2863) |
| 33 | `38-returned-array-shape.md` | 🟡 | ⚙️ | Same shape-loss family as `40` |
| 21 | `39-reconcile-array-metadata-stale.md` | 🟠 | ⚙️ | `syncArrayNodeMembership` only handles disappearing keys; `$TRACK` not notified — pair with `04` |
| 7 | `40-snapshot-array-holes-metadata.md` | 🟠 | ✅ | `snapshotImpl` iterates by length from `[]` — iterate own keys; pair with `05` |
| 10 | `41-snapshot-root-cycle.md` | 🟡 | ✅ | Regression; seed the cycle-map placeholder before recursing |

## Signals, async & scheduler

| Order | Draft | Sev | Fix | Notes |
|---|---|---|---|---|
| 39 | `09-writable-async-memo-race.md` | 🔴 | 🧠 | GA blocker; two-part root cause — write-vs-inflight priority is a design call; issue only |
| 28 | `13-memo-double-recompute-lost-cleanup.md` | 🔴 | ⚙️ | GA blocker; `_pendingDisposal` stash blindly overwritten — merge instead of replace; core commit protocol is subtle |
| 40 | `14-error-heal-equal-value.md` | 🔴 | 🧠 | GA blocker; needs an error analog of `settlePendingSource` — architectural asymmetry; issue only |
| 29 | `15-boundary-dispose-skips-sibling-queue.md` | 🟠 | ⚙️ | Mutate-while-iterating (`removeChild` splices during `Queue.run`) — snapshot children or re-flush |
| 41 | `16-throwing-effect-drops-siblings.md` | 🟡 | 🧠 | ⚠️ Philosophy risk (halt-loudly, #2814 declined) — frame as *same-flush sibling loss*, not error containment; issue only |
| 13 | `17-map-falsy-fallback-leak.md` | 🟡 | ✅ | Truthiness test on cached mapped value — use a sentinel/flag; also 1.x |

**Cluster note**: the async-settlement cluster (`10`/`11`/`12`) is fully resolved in beta.17.

## Client DOM, events & components

| Order | Draft | Sev | Fix | Notes |
|---|---|---|---|---|
| 27 | `02-dispose-wipes-preexisting-content.md` | 🟠 | ⚙️ | dom-expressions; reuse the mount-time `element.firstChild` check for teardown; implement with `31` (same disposer); 1.x identical; live StackBlitz exists |
| 15 | `18-delegated-bound-handler-stale-data.md` | 🟡 | ✅ | `$$clickData` never cleared on handler swap — one `delete`; dom-expressions |
| 16 | `19-bound-handler-array-mutation.md` | 🟡 | ✅ | `handler[0] = wrapper` writes into the user array — use a local; dom-expressions |
| 37 | `20-property-binding-undefined.md` | 🟡 | ✅ | Mechanically `?? ""`, but a semantics decision compiler + spread path must share |
| 35 | `21-fragment-stranded-children.md` | 🟡 | ⚙️ | No `nodeType === 11` handling anywhere — snapshot fragment children at insert; dom-expressions |
| 14 | `22-dev-crash-frozen-component.md` | 🟡 | ✅ | 3 unguarded `Object.assign(Comp, {[$DEVCOMP]})` sites — add `Object.isExtensible` guard; dev-only |

## SSR string & streaming

| Order | Draft | Sev | Fix | Notes |
|---|---|---|---|---|
| 5 | `01-reveal-nested-loading-grouping.md` | 🟠 | ✅ | Server/client divergence; mirror the client one-liner (`setContext(RevealGroupContext, null)` on the boundary owner); live StackBlitz exists |
| 18 | `23-assets-element-crash.md` | 🔴 | ⚙️ | Regression; asset thunks run after `root()` returns → null owner throws in `getNextContextId()` — capture owner or render eagerly |
| 17 | `25-ssr-object-binding-leading-separator.md` | 🟡 | ✅ | `if (i)` separator logic — track "emitted" instead of index; covers 2 findings (w24+w25); dom-expressions |

## Hydration

| Order | Draft | Sev | Fix | Notes |
|---|---|---|---|---|
| 22 | `26-hydration-nullish-serialized-value.md` | 🔴 | ⚙️ | Data-corruption class; nullish conflates "missing" and envelope unwrap — needs explicit has-check |
| 23 | `27-hydration-hybrid-sync-store-write-dropped.md` | 🔴 | ⚙️ | Data loss in the recommended `ssrSource: "hybrid"` mode |
| 11 | `28-hydration-preload-dispose-resurrects.md` | 🟠 | ✅ | Disposer only stored after `p.then` — check a disposed flag in the resolution; dom-expressions |
| 24 | `29-late-renderid-root-client-renders.md` | 🟠 | ⚙️ | `_$HY.done` is global; completion must be per-renderId — multi-root/islands affected; contradicts documented API |
| 12 | `30-stale-event-blocks-replay-queue.md` | 🟠 | ✅ | `runHydrationEvents` returns without shifting a disconnected-target head — skip/requeue; we know this function well (finding-11 relay) |
| 26 | `31-hydrate-disposer-deletes-ssr-dom.md` | 🟠 | ⚙️ | Documented-contract violation — strongest framing of the disposer family; implement with `02` |
| 25 | `32-injected-comment-breaks-text-hydration.md` | 🟡 | ⚙️ | `parent.firstChild.data` assumes ownership; extensions/CDN rewriters inject nodes in the wild |

## Implementation sequence (flat)

| Phase | Order | Drafts |
|---|---|---|
| Easy quick wins (issue+PR pairs) | 1–17 | ~~24~~ ✅ [PR #541](https://github.com/ryansolid/dom-expressions/pull/541) · ~~10~~ ✅ [#2866](https://github.com/solidjs/solid/issues/2866) · ~~12, 11~~ ✅ [#2869](https://github.com/solidjs/solid/issues/2869)/[#2868](https://github.com/solidjs/solid/issues/2868) · **01 (← next)** · 05, 40 (snapshot pair) · 34, 35, 41 · 28, 30 (hydration easy) · 17 · 22, 18, 19 (dom-expressions easy) · 25 |
| P1 regressions, moderate | 18–21 | 23 · 03 · 04, 39 (reconcile pair) |
| Hydration data-loss & lifecycle | 22–27 | 26, 27 · 29, 32 · 31, 02 (disposer pair) |
| Scheduler/core moderate | 28–29 | 13, 15 |
| Store/projection semantics | 30–37 | 33, ~~36~~ ✅ (beta.17), 37, 38, 06, 21, 07, 20 |
| Design-heavy — file as issues only | 38–41 | 08, 09, 14, 16 |

## Cross-cutting reminders

- **Handle together:** `02`↔`31` (the same container disposer); `04`↔`39` (reconcile notifications/membership); `05`↔`40` (snapshot/unwrap enumeration and array shape). Fixed in beta.17: `10` ([#2866](https://github.com/solidjs/solid/issues/2866)), `11`↔`12` async settlement ([#2868](https://github.com/solidjs/solid/issues/2868)/[#2869](https://github.com/solidjs/solid/issues/2869)), `24` (dom-expressions #541), `36` (PR #2863 — `37`'s `length` validation remains open).
- **Cross-reference, but keep the implementation separate:** `38`↔`40` both lose array shape through different paths (setter-return materialization vs `snapshot()`/`deep()`); `18`↔`19` are delegated vs direct event-handler paths; and `26`↔`27` are hydration data-loss bugs with distinct causes.
- dom-expressions-layer findings (18, 19, 21, 25, 02/31, 28, 30, 32): sharp issues beat fix PRs — the maintainer re-implements at his preferred layer (#2814/#2816/#535/#536 precedent).
- Design-heavy four (08, 09, 14, 16): semantics questions; PRs there historically get closed unmerged.
- Live StackBlitz links: `01` and `02` (saved stackblitz.com/edit links). The rest are paste-ready — mint links with the solid-repros workflow before filing.
