# Solid 2.0 beta issue drafts

GitHub-ready Markdown drafts for every **still-reproducing** issue in the local bug-hunt logs,
in one flat folder with normalized `01-`…`41-` prefixes. Resolved findings are intentionally not
recreated: their upstream issue/PR references remain in the corresponding `HUNT-*.md` ledger.

Current coverage: **36 drafts representing 37 findings** (`25-` covers wave-2 findings 24+25 —
same SSR separator root cause and fix). Grouped below by **area**; the "origin" column maps each
draft back to its hunt-log finding ID.

**Triage**: see [`TRIAGE.md`](TRIAGE.md) for severity, fix effort, implementation order, and
per-draft root-cause notes.

Sources: wave 1 = `../HUNT-2.0-beta.15.md` · wave 2 = `../HUNT-2.0-beta.15-wave2.md` ·
wave 3 = `../HUNT-2.0-beta.16-wave3.md` · stores audit = `../HUNT-2.0-beta.16-stores-projections.md`

Status: all waves re-verified 2026-07-11 at `next` `a51cac19` (**2.0.0-beta.17**). Removed there:
`10-` (w9 → #2866), `11-` (w10 → #2868), `12-` (w11 → #2869), `24-` (w23 → dom-expressions #541,
shipped in 0.50.0-next.17), `36-` (stores-audit s4 → PR #2863). Earlier removals: wave-1 findings
6/7/8/9/16 at beta.16+7 (#2857–#2861); `w7` at beta.16 (#2842).

## Store & projections (14)

| Draft | Origin | What | Priority |
|---|---|---|---|
| `03-store-map-set-date-crash.md` | w1 | Map/Set/Date store values crash on internal-slot access | P1 regression |
| `04-reconcile-keyless-leaf.md` | w2 | reconcile updates but never notifies Date/Map/Set leaves — family of `39-` | P1 regression |
| `05-snapshot-drops-symbol-keys.md` | w3 | snapshot drops symbol keys after a write — family of `40-` | P2 regression |
| `06-accessor-setter-shadowed.md` | w4 | store write bypasses own accessor setter, kills getter | P2 regression |
| `07-freeze-store-poison.md` | w5 | `Object.freeze(store)` permanently poisons the store | long-standing |
| `08-draft-reassign-identity.md` | w6 | row swap clones edited rows, store identity lost | P1 regression |
| `33-projection-draft-identity.md` | s1 | projection drafts return fresh nested proxy per read (`includes()` breaks) | |
| `34-empty-string-projection-key.md` | s2 | `key: ""` ignored, reconciles by `id` | |
| `35-projection-defineproperty-noop.md` | s3 | `defineProperty()` on a draft succeeds but drops the property | |
| `37-array-length-validation.md` | s5 | store array `length` accepts invalid values, skips JS coercion | regression |
| `38-returned-array-shape.md` | s6 | array returned from a setter fills holes, ignores named/symbol props | |
| `39-reconcile-array-metadata-stale.md` | s7 | reconcile leaves tracked named/symbol array props stale — family of `04-` | |
| `40-snapshot-array-holes-metadata.md` | s8 | snapshot/deep fill sparse holes, drop array metadata — family of `05-` | |
| `41-snapshot-root-cycle.md` | s9 | snapshot breaks root self-cycle identity after a write | regression |

## Signals, async & scheduler (6)

| Draft | Origin | What | Priority |
|---|---|---|---|
| `09-writable-async-memo-race.md` | w8 | writable async memo silently swallows `set()` mid-fetch | P1 GA blocker |
| `13-memo-double-recompute-lost-cleanup.md` | w12 | double-recompute in one flush loses cleanups, leaks child owners | P1 GA blocker |
| `14-error-heal-equal-value.md` | w13 | error healed to an `equals`-equal value never clears downstream | P1 GA blocker |
| `15-boundary-dispose-skips-sibling-queue.md` | w14 | boundary self-dispose skips sibling boundary's queued effects | P2 GA blocker |
| `16-throwing-effect-drops-siblings.md` | w15 | unhandled effect throw permanently drops queued siblings | long-standing |
| `17-map-falsy-fallback-leak.md` | w16 | mapArray/repeat recreates falsy fallback per empty update, leaks owner | long-standing |

## Client DOM, events & components (6)

| Draft | Origin | What | Priority |
|---|---|---|---|
| `02-dispose-wipes-preexisting-content.md` | wave1 #20 | `render()` disposer wipes pre-existing container content — same disposer as `31-` | 1.x + 2.0 |
| `18-delegated-bound-handler-stale-data.md` | w17 | delegated `[fn, data]` leaks data to a later handler on the same element | long-standing |
| `19-bound-handler-array-mutation.md` | w18 | non-delegated `[fn, data]` mutates the user tuple | long-standing |
| `20-property-binding-undefined.md` | w19 | `undefined` renders the literal string "undefined" | long-standing |
| `21-fragment-stranded-children.md` | w20 | DocumentFragment children stranded after a reactive slot update | long-standing |
| `22-dev-crash-frozen-component.md` | w21 | dev build crashes on frozen/non-extensible component function | long-standing |

## SSR string & streaming (3)

| Draft | Origin | What | Priority |
|---|---|---|---|
| `01-reveal-nested-loading-grouping.md` | wave1 #17 | nested `<Loading>` registers into ancestor `<Reveal>` group; `order="together"` over-waits | |
| `23-assets-element-crash.md` | w22 | `<Assets>`/`useAssets()` element children crash SSR | P1 regression |
| `25-ssr-object-binding-leading-separator.md` | w24+25 | object style/class SSR output has a leading separator | long-standing |

## Hydration (7)

| Draft | Origin | What |
|---|---|---|
| `26-hydration-nullish-serialized-value.md` | wave3 #21 | serialized `null`/`undefined` lost; resolved async wrapper exposed |
| `27-hydration-hybrid-sync-store-write-dropped.md` | wave3 #22 | `ssrSource: "hybrid"` drops synchronous store mutations after hydration |
| `28-hydration-preload-dispose-resurrects.md` | wave3 #23 | dispose during root-module preload doesn't cancel the later mount |
| `29-late-renderid-root-client-renders.md` | wave3 #24 | later `renderId` root client-renders instead of hydrating server DOM |
| `30-stale-event-blocks-replay-queue.md` | wave3 #25 | one stale pre-hydration event blocks every later queued event |
| `31-hydrate-disposer-deletes-ssr-dom.md` | wave3 #26 | `hydrate()` disposer deletes SSR DOM despite the API contract — same disposer as `02-` |
| `32-injected-comment-breaks-text-hydration.md` | wave3 #27 | injected comment permanently stales or duplicates a hydrated text slot |

## Cross-cutting near-duplicates (consider filing together)

- `02-` ↔ `31-`: same `client.js` disposer wipes the container; different entry points (`render()` vs `hydrate()`), and `31-` additionally violates the documented `hydrate()` contract.
- `04-` ↔ `39-`: reconcile updates but never notifies (built-in leaves vs array metadata).
- `05-` ↔ `40-`: `snapshotImpl` metadata loss after a write (symbol keys vs array holes/metadata).

## Notes for filing

All drafts follow the published-issue template (matching the `#2846`/`#2869`/`#2860` format:
Describe → Example → Steps → Expected → Screenshots → Platform → Additional context →
"Does this exist in Solid 1.x?"), with titles and Platform blocks at `2.0.0-beta.17`
(`next` @ `a51cac19`). Repro code was reshaped 2026-07-11 into small realistic components
(button + PASS/FAIL verdict banner, no `createRoot`/module-scope probe ceremony) while keeping
each validated triggering sequence — **the embedded examples have not been re-executed since
the reshape**, so give each one a quick run when creating its StackBlitz.

Wave-2-origin drafts (`03-`–`25-`) each have a failing repro (untracked `hunt2-*` test), a
root-cause pointer, and a 1.x verdict backed by a `w2-*` check in `../hunt-1x-checks/`. Most
StackBlitz launch links still need to be created; each draft ends with the local failing test path.

Filing/implementation order: see the full sequenced plan in [`TRIAGE.md`](TRIAGE.md)
(security → easy quick wins clustered by area → P1 regressions → hydration data-loss →
moderate semantics → design-heavy last, filed as issues only).
