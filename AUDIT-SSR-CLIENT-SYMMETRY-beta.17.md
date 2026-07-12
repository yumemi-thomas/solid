# Audit: server/client rendering symmetry — 2.0.0-beta.17

**Scope.** Solid 2.0 keeps a mirrored server implementation (`packages/solid/src/server/*`, `packages/solid-web/server/*`, dom-expressions server runtime) that must produce the same *observable* semantics as the client runtime (`packages/solid/src/client/*`, `packages/solid-signals`, dom-expressions client). Drafts `01-reveal-nested-loading-grouping` and `43-errored-reveal-scope` exposed one instance of the drift class (client severs reveal scope inside boundaries, server port didn't). This audit swept the whole mirrored surface for further instances, in five areas: boundaries/Reveal semantics, control-flow components, reactive primitives, component/props layer, and the hydration protocol.

**Baseline.** Branch `fix/reveal-nested-boundary-scope` @ 8fff1bf1 (includes the draft-01 Loading severing fix), `next` a51cac19, beta.17. All findings below were **runtime-verified against the freshly built dist chain** unless marked otherwise. Known issues (issue-drafts/ 01–43, HUNT-2.0-beta.15/wave2/wave3/beta.16 ledgers, #2776/#2779/#2801/#2857 fixes) were excluded; duplicates across sweep areas were merged (noted as "cross-confirmed").

**Verdict.** The mirrored-implementation strategy is leaking systematically: 30 unreported asymmetries, 11 of them P1. Three recurring failure patterns:

- **P-A — client behavior not ported to server**: severing/`reconcile`/error-routing/thenable-handling exists client-side only (same class as drafts 01/43).
- **P-B — server fix not ported to client** (the inverse): #2780, #2857, #2801-class fixes landed on one side only.
- **P-C — hydration-id bookkeeping drift**: any construct that consumes/allocates child-id slots differently per side shifts every subsequent sibling's key.

---

## Intent assessment — bug vs design

Every finding was runtime-verified to *diverge*; the only uncertainty is intent. Classification by evidence type, for filing strategy:

**Class 1 — missed spot of an already-made decision (file as bugs, no framing needed).** A fix or parity shim exists for the sibling case, so the project has already chosen the behavior:
- One-sided fixes: **19** (#2769 client-only), **20** (#2780 server-only), **14** (#2857 applied to `lazy` but not `dynamic`), **9** (#2801 applied to sync memos only).
- Sibling shims exist, this one skipped: **10** (`createTrackedEffect`/`onSettled` id shims sit next to the missing `createReaction` one), **11** (server `createOwner` supports `transparent`; the memo paths never forward it).
- Self-contradicting code: **13** (the server comment justifying `natural` composite readiness relies on a `held` flag that `register` never sets for natural — implementation error regardless of which contract wins; the *contract* half still needs the doc call below).

**Class 2 — no plausible intent (file as bugs).** Deadlocks, crashes, and hydration-integrity violations: **1** (skeleton forever), **7** (`$df` debris), **15** (Switch null SSR crash), **16**'s client `RangeError` on `count={NaN}`, **18**'s cyclic-state crash, **17** (`REACTIVITY_HALTED` / silent unwrap), **6**'s unhandled-rejection process crash, **30** (hung stream), and the id-drift trio **9/10/11** — hydration id agreement is a hard protocol requirement. Also here: **2** (server has `ServerComputation` thenable machinery; `Show`/`Match` just don't use it), **4/5** (violate the documented `storeSetter`/projection commit contract), **21** (error-tracker spam), **29** (docs explicitly promise instance sharing).

**Class 3 — genuine design questions (file with the draft-01 "which behavior is intended?" framing; present both sides + doc citations, let maintainers pick):**
- **3** `createEffect` throw routing: server rethrow is deliberate (#2777) AND client not-reaching-boundaries is deliberate (its own docstring) — the two decisions contradict each other. The dropped `EffectBundle` error handler is a plain bug whichever contract wins.
- **8** `Portal`: deliberate error message, so possibly "not yet implemented" — but a 1.x regression either way; maintainers should choose 1.x no-op vs crash.
- **6**'s swallow-and-render-seed half: graceful degradation is conceivably intended; serializing it as *success* that the client then contradicts is the part to confirm.
- **12** `createRevealOrder`: the no-op passthrough is pinned by an existing test (partial intent likely); the ancestor-group membership leak contradicts the contract the draft-01 fix just established — the severing half is real regardless.
- **13**'s contract half + **16**'s `count={undefined}` fallback semantics: docs and code disagree about which side is right; that they differ is not in question.

**Class 4 — deliberate stubs (file as docs/DX gaps, not bugs):** **26** `resolve()` throws (explicit message), the `lazy()` manifest requirement, and arguably **22/23/24** (`flush(fn)`/`action()`/`getObserver()` — SSR is one-shot, effects and actions "don't run" by design). Even so, `flush(fn)` *dropping the callback* and `action()` returning a raw `Generator` instead of a promise look like oversights — the parity-preserving stubs are one-liners (`flush(fn)` → run `fn`; `action(fn)` → wrap in a promise-returning driver). **27** `deep()` is an obvious shortcut but violates its own documented "plain (non-proxy) deep copy" contract, so it files as a bug; **25** and **28** are judgment calls in the same vein.

---

## P1 — wrong or stuck user-visible content

### 1. Empty / all-sync nested `<Reveal>` under `order="together"` deadlocks the outer group forever
A nested `<Reveal>` registers as a composite slot, but if none of its children register a fragment (static content, or all `<Loading>` children resolve synchronously at discovery) it fires `onResolved` without ever firing `onMinimallyResolved`. Outer `together` requires `minimallyResolved.size === keys.length` → the `$dfj` activation is **never emitted**: content streams into templates but the skeleton is shown forever. Client: an empty controller is trivially minimally ready; reveals normally.
- Server: `packages/solid/src/server/flow.ts:402-412` (only child callbacks update self-readiness), `:525-527` (empty group fires `onResolved` only), `:508-517` (composite `onResolved` doesn't `markMinimallyResolved`), `:432-435` (release check unsatisfiable). Client: `packages/solid-signals/src/boundaries.ts:154-176`.
- Repro kept: `scratchpad/reveal-empty-composite.spec.ts` (session scratchpad). Realistic trigger: a shared section component that wraps children in `<Reveal order="natural">` and only sometimes has async content.
- Fix: composite `onResolved` should also mark minimal; empty group should fire `onMinimallyResolved`.

### 2. `<Show when={promise}>` / `<Match when={promise}>`: server renders children with the raw Promise, client awaits and narrows
Client deliberately routes `when` through `handleAsync` (suspend → narrow to resolved value). Server reads `when` inside a sync memo with no thenable detection: a Promise is a truthy object → children render immediately; keyed callbacks receive the raw Promise (`[object Promise]` interpolations, `undefined` member reads). `Promise.resolve(false)` renders **children** on the server, **fallback** on the client — content flip + guaranteed hydration mismatch.
- Server: `packages/solid/src/server/flow.ts:137-152` (Show), `:166-185` (Switch); `createSyncMemo` `server/signals.ts:682`. Client: `packages/solid/src/client/flow.ts:176-181`, `:257-260`.
- Repros: `scratchpad/ssr-flow-audit.mjs` (`show-when-promise-*`, `switch-match-promise`), `packages/solid-web/test/hunt4-flow-asymmetry.spec.tsx` tests 1–2.

### 3. `createEffect` compute-phase throw: SSR renders the `Errored` fallback, client renders content
Client routes user-effect compute errors to the effect's error arm (or `console.error` + skip) — they never reach a boundary. Server re-throws them into `createErrorBoundary` (#2777 made this deliberate server-side) and **drops the `EffectBundle` error handler entirely** (`serverEffect` never unpacks the bundle). Same tree: SSR streams the error fallback + serialized error; client render shows children.
- Server: `packages/solid/src/server/signals.ts:1090-1096`, `:1080-1087` (rethrow), `:1676-1684` (serialization). Client: `packages/solid-signals/src/core/effect.ts:135-153`; contract stated at `signals.ts:374-376`.
- Note: `createRenderEffect` errors route to boundaries on **both** sides — the asymmetry is `createEffect` only.

### 4. Projection / derived-store commit: `Object.assign` instead of keyed `reconcile` — phantom keys and stale array tails in SSR output
Client commits function-store/projection returns via `reconcile` (deletes absent keys, sets array length). Server uses `Object.assign` in the sync return and **every async arm**. `createProjection(() => ({b:2}), {a:1})` → server `{a:1,b:2}` vs client `{b:2}`; `() => [4,5]` over seed `[1,2,3]` → server `[4,5,3]`. Applies to `createStore(fn, seed)` and `createOptimisticStore(fn, seed)` too (server aliases them to `createProjection`). SSR renders phantom rows/fields the client render doesn't have.
- Server: `packages/solid/src/server/signals.ts:1407-1411`, `:1243-1249`, `:1285-1291`, `:1329-1339`, `:1390-1394`; aliases `:1167-1175`. Client: `packages/solid-signals/src/store/projection.ts:147-153`.

### 5. Store setter return-form is a silent no-op on the server
`setState(s => ({todos: s.todos.filter(...)}))` — documented API — replaces state on the client (`storeSetter` honors the return, `store/store.ts:839-856`) but the server setter is `(fn) => fn(state)`: return value discarded, store unchanged (`server/signals.ts:1172`). Isomorphic setup code produces different SSR HTML.

### 6. Async projection/store rejection: swallowed on server (seed rendered as success) vs `Errored` on client — plus a possible process crash
Server `onError` arms are `(_error) => { markReady(); }`: reads fall through to seed/partial state and rendering continues as success. Client propagates a `StatusError` to the nearest `Errored`. Additionally the internal `deferred.reject` leaves a rejected promise consumed only under an async SSR ctx — under `renderToString` (or ctx-less use) it's a **guaranteed unhandled rejection** (verified Node crash).
- Server: `server/signals.ts:1250-1253`, `:1292-1294`, `:1342-1345`, `:1396-1399`, `:527`. Client: `core/async.ts:203-208`.

### 7. dom-expressions `$df` swap stops at ANY comment node — permanent fallback debris in the DOM
The `$df` removal loop terminates at the first comment of *any* kind, not the matching `<!--pl-X-->`. A `<Loading>` fallback containing dynamic text holes legally contains `<!--!$-->` separators — the swap inserts content **mid-fallback**, leaving `CONTENT42% done` style debris. Fully-streamed-before-hydrate (fast network, deferred JS) never recovers; other modes show the wrong pre-hydration state.
- Consumer: dom-expressions `src/server.js` `REPLACE_SCRIPT` (`$df`, ~line 165, including the `_$HY.done` branch). Emitter: `packages/solid/src/server/hydration.ts:211-217` + `resolveSSRNode` separators (`src/server.js:1290,1340`).
- Failing test kept: `packages/solid-web/test/hydration/hunt6-asym.spec.tsx › dynamic-fallback [loaded]`. Fix: loop while `!(o.nodeType === 8 && o.nodeValue === "pl-"+e)`. Same repo/PR as draft-01 Part 2 ($df queue) — should ship together. `$dfl`/`cleanupFragment` already scan correctly.

### 8. `<Portal>` hard-crashes SSR — 1.x regression (cross-confirmed ×2)
Server `Portal` is `throw new Error("Portal is not supported on the server")`; 1.x rendered `""` (no-op, confirmed against 1.x dist). Any isomorphic tree with a modal/tooltip crashes `renderToString`/`renderToStream`, or — worse — bakes the `Errored` fallback into the streamed HTML while a pure client render shows the app.
- Server: `packages/solid-web/server/index.ts:128-130`. Client: `packages/solid-web/src/index.ts:209-262`. Minimum fix: 1.x no-op + client-side hydration skip.

## P1 — hydration-id / state integrity

### 9. Non-sync server memo NotReady retry never resets children — id drift + duplicated primitives
Every client recompute zombifies previous children and resets `_childCount = 0`. The server async-retry path re-runs `comp.compute` under the same owner without either — each NotReady retry **appends** child-id slots (verified: `['r10','r11']` server vs `['r10','r10']` client) and keeps first-pass children alive. Any user `createMemo` that allocates ids (nested primitives, JSX, `createUniqueId`) and reads a pending async source drifts every serialized key/DOM claim after it. This is exactly the class #2801 fixed for sync memos (`createSyncMemo.pull`, `server/signals.ts:709-711`) — the non-sync path was missed.
- Server: `server/signals.ts:613-631`, `:622`, `:858`. Client: `packages/solid-signals/src/core/core.ts:186-192`.

### 10. `createReaction` `track()` consumes a client id slot, server no-op (cross-confirmed ×3)
Client `track()` synchronously creates an effect node → one child id per call. Server returns `tracking => tracking()` — no id, ever. A component arming a reaction in its body (the documented pattern) shifts every subsequent sibling's hydration id: serialized async values load under wrong keys, DOM claims mismatch. The server file already has parity shims for `createTrackedEffect` and `onSettled`; `createReaction` was missed.
- Server: `server/signals.ts:1115-1122`. Client: `packages/solid-signals/src/signals.ts:566-609` + `core/core.ts:489-490`. Fix: allocate `getNextChildId` per `track()` call.

### 11. Server `createMemo` ignores `transparent: true` — silent loss of reactivity after hydration
Client honors `transparent` (no id consumed). Server always `createOwner()`s → consumes a slot. Result: server emits `_hk` ids shifted by one; client claiming misses, `getNextElement` silently builds a detached tree, bindings attach to orphaned DOM — hydration *looks* fine but the first post-hydration update is dropped. This is the server-side half of the known solid-refresh id-shift story: fixing solid-refresh alone still drifts.
- Server: `server/signals.ts:595`, `:686` (transparent never forwarded; server `createOwner` supports it at ~`:173`). Client: `core/core.ts:425-429`, `client/hydration.ts:539`.
- Failing test kept: `hunt6-asym.spec.tsx › transparent-memo [loaded]`.

---

## P2 — significant divergence, narrower trigger

### 12. `createRevealOrder` is a server no-op and its children leak into the ancestor `<Reveal>` group (cross-confirmed ×2)
The documented "primitive form of `<Reveal>`" does nothing on the server (`order`/`collapsed` ignored, no context set, no composite registration) **and** its `<Loading>` children see the ancestor group's `RevealGroupContext`, registering as direct slots of the *outer* group — outer `together` then waits on the custom group's slowest child. Same context-severing class as drafts 01/43, one level up. (An existing test pins the passthrough, so the no-op may be a shortcut; the membership leak is pinned nowhere and contradicts the fixed contract.)
- Server: `server/signals.ts:1729-1738` (exported `server/index.ts:16`). Client: `boundaries.ts:540-565`; `client/flow.ts:502-507` delegates to it.

### 13. `natural`-order composite readiness: server requires FULL resolution, client only minimal
Server treats a composite child of a `natural` group as minimally ready only when fully resolved (the code comment claiming natural "holds" composites is false in its own file — `register` never sets `held` for natural). Client tests `slot.isMinimallyReady()`. Three-level nesting: client releases at max(fast slots), server holds the whole page for the slow grandchild. Timing-only (no deadlock). Doc lines 236-237 of `03-control-flow.md` describe the server behavior while the client implements minimal — one of the two is wrong; either way server ≠ client.
- Server: `server/flow.ts:407-410` vs `:477-484`. Client: `boundaries.ts:157-167`. Shares a fix site with finding 1.

### 14. Server `dynamic()` swallows falsy promise rejections (#2857 class, missed spot)
`if (error) throw error` — a rejection with `undefined/null/0/""` is success-with-undefined: SSR serializes the Loading fragment as *resolved success* with no content; client believes it succeeded and shows an empty slot, while pure CSR shows the `Errored` fallback. `lazy()` and `ServerComputation` already use the `errored` presence-flag pattern; `dynamic` was missed.
- Server: `packages/solid-web/server/index.ts:100-104`. Fix: mirror the `errored` flag.

### 15. `<Switch>` with null/undefined resolved children: server TypeError crash, client renders fallback
Server wraps non-array children as `[conds]` → `null.when` throws. Client `toArray()` maps null → `[]` → fallback. `<Switch fallback={<NotFound/>}>{maybeMatches() ?? null}</Switch>` crashes SSR only. (A null *among* Match siblings crashes both sides — symmetric, not counted.)
- Server: `server/flow.ts:168-172`. Client: `client/flow.ts:250` + `client/core.ts:181-184`.

### 16. `Repeat`/`For` empty-detection: truthiness (server) vs `=== 0` (client) — fallback flips, client-only crash
`count={undefined}` → SSR shows fallback, client shows nothing (mismatch). `count={NaN}` → SSR renders fine, client throws `RangeError: Invalid array length` during render/hydration. Non-array truthy `each` → SSR fallback, client nothing.
- Server: `server/signals.ts:1571-1578`, `:1525`. Client: `packages/solid-signals/src/map.ts:319-343`, `:109-160`.

### 17. `readHydratedValue` envelope-sniffing corrupts user values shaped `{s,…}`/`{v,…}`
deferStream writes **raw resolved values** into `_$HY.r[id]`, sharing the namespace with promise envelopes, no discriminator. Client sniffs `.s === 2` / `.v` on whatever it loads: a legitimate payload `{s:2, v:"payload"}` → client throws → **REACTIVITY_HALTED** (app bricks post-hydration); `{v:"inner"}` → silent unwrap corruption. Inverse manifestation of draft 26's function — its fix direction does not cover this; the raw-value path needs a tag/envelope.
- Consumer: `client/hydration.ts:270-275`. Emitter: dom-expressions `src/server.js:388-391`.
- Failing tests kept: `hunt6-defer-probe.spec.tsx` (both).

### 18. Generator-projection SSR state is a lossy JSON round-trip
Server locks SSR-visible generator-projection state via `JSON.parse(JSON.stringify(state))`: `Date` → string (`.toLocaleDateString()` throws server-only), `Map/Set` → `{}`, `undefined`/functions dropped, `NaN` → null, **cyclic state throws and crashes SSR**. Client commits real values via reconcile.
- Server: `server/signals.ts:1339`, `:1357`.

### 19. `merge()` drops symbol-keyed props from function sources on the server (#2769 fix not ported)
Server's function-source proxy `ownKeys()` returns `Object.keys()` (strings only); client `merge` uses `ownEnumerableKeys` (includes symbols, explicitly for #2769). `{...merge(() => defaults, props)}` loses symbol props in SSR only. Plain-object sources fine on both.
- Server: `server/signals.ts:1434-1458`. Client: `store/utils.ts:289-294`, `store/store.ts:199-202`.

### 20. Client `lazy()` leaks an unhandled rejection on chunk-load failure (#2780 fixed server-side only — pattern P-B)
Server `load()` attaches a rejection handler precisely to avoid this; client `p.then(mod => …)` has none (load + preload paths). Error-surface parity is fine (both route to `Errored`), but every failed client chunk load fires a spurious global unhandled rejection (Sentry noise).
- Client: `client/component.ts:139-141`, `:157`. Server: `server/component.ts:99-113`. Fix: add a no-op rejection arm.

### 21. Every SSR-side async rejection produces unhandled promise rejections on the client
Seroval's reject-replay rejects `_$HY.r[<id>]` and `<key>_fr` at parse time; the client attaches handlers only on the pending-promise hydration branch — in the loaded case (and the data promise in all modes) nothing ever handles them. UI recovers by design, but error trackers log 2 phantom rejections per SSR async error.
- Consumer: `client/hydration.ts:1289`, `:1461`. Verified via stream-replay artifact (`hunt6-reject-gen.spec.tsx`).

---

## P3 — API-contract divergences in isomorphic code paths

| # | API | Server | Client | Observable |
|---|-----|--------|--------|------------|
| 22 | `flush(fn)` | zero-arg no-op, callback **dropped** (`server/signals.ts:1746`) | runs `fn`, returns result (`core/scheduler.ts:762-795`) | isomorphic `flush(() => …)` silently skips work during SSR |
| 23 | `action(fn)()` | returns the raw generator fn; calling yields a `Generator`, body never runs (`server/signals.ts:1770-1772`) | returns `(...args) => Promise` (`core/action.ts:60-128`) | `await save()` in shared code never executes, no error |
| 24 | `getObserver()` | `null` in sync memos (all compiler JSX memos); not cleared by `untrack`; returns `ServerComputation` (`server/signals.ts:427-441`, `:1742-1744`) | non-null in every tracking scope, null under `untrack` (`core/owner.ts:190-193`) | "subscribe only if tracked" library code branches differently per side |
| 25 | writable memo `createSignal(fn, {lazy})` | `lazy` dropped → computes eagerly (extra SSR fetches); setter returns `undefined` (`server/signals.ts:551-557`) | lazy honored; setter returns written value | wasted server work; return-value use diverges |
| 26 | `resolve()` | throws "not implemented" (`server/signals.ts:1748-1750`); types claim `Promise<T>` | real implementation | shared data helpers crash SSR only |
| 27 | `deep(store)` | returns the live store (`server/signals.ts:1430-1432`) | plain deep copy (`store/utils.ts:157-159`) | mutating the "copy" mutates the store on the server only; identity checks flip |
| 28 | `createUniqueId()` outside reactive context | throws (`server/component.ts:231-235`) | falls back to `cl-${counter}` (`client/component.ts:181-183`) | module-scope ids crash SSR only |
| 29 | `dynamic()` source | evaluated once **per instance** (`solid-web/server/index.ts:57-62`) | one shared lazy memo per `dynamic()` call (`src/index.ts:288`; docs promise sharing) | non-idempotent sources render different components per instance SSR; duplicated fetches |
| 30 | promise stamping | `processResult` writes `.s`/`.v` onto the **user's** promise (`server/signals.ts:861-871`); frozen promise → throw inside `.then` → deferred never settles → **hung stream** | never mutates user promises | frozen/proxied promises hang SSR |

Minor notes (documented-behavior gaps, not filed as findings): `lazy()` without a `manifest` throws on the server (clear message, but isomorphic code crashes SSR only); client `lazy()` glob/cache-miss hydration path allocates one extra id vs server (only reachable on a path the server already warns about; static analysis, medium confidence).

---

## Checked and symmetric (coverage)

Verified equivalent on both sides during the sweep — safe to rely on:

- **Reveal/boundaries**: 8fff1bf1 severing (children + fallback owners); errored-slot handling in groups (#2776 class) under all three orders; collapsed-sequential frontier mechanics; sequential/together/natural leaf matrices + 2-level nesting; Loading-in-Reveal-fallback and Reveal-in-Loading severing; `onSettled` server shim id parity; `Errored` error-class routing (NotReady rethrow → enclosing Loading; fallback errors → parent boundary).
- **Flow**: Show keyed/non-keyed shapes and falsy-`when`; Show/Switch id-slot padding; Switch first-match short-circuit; For keyed/non-keyed callback shapes; For `each` = null/false/""/[]; falsy `fallback` handling; Repeat `from`/count=0/element children; Errored fallback arity + sync-error serialization.
- **Primitives**: context (`createContext`/`get`/`setContext`, clone-on-write, error classes); owner/cleanup dispose ordering incl. 25a5685b pool reset; `mapArray`/`repeat` row-id + computed-slot parity; `isPending`/`latest` first-render suspension; falsy rejections (#2857) and thenable detection (#2858) in `ServerComputation`; `createRenderEffect` error routing; sync-memo child reset (#2801).
- **Component layer**: `createComponent` (prod + dev transparent root); `children()`/`toArray()` two-memo structure; `omit`; `merge` except finding 19; `Dynamic` props forwarding; `lazy` main hydration paths; export surface (only inert type/`createDeepProxy` diffs).
- **Protocol**: `formatChildId` byte-identical; Loading boundary fake-depth id calibration; Errored owner-pair calibration; rejected-fragment envelope shape; sync `"$$f"` path; NoHydration zones; writable-memo serialization; projection patch-op shapes; `$dfl`/`cleanupFragment` exact marker scan.

## Repro artifacts

- `scratchpad/reveal-empty-composite.spec.ts` (finding 1) — session scratchpad `/private/tmp/claude-501/-Users-thomas-Documents-Github-solid/efbcf93f-b6c3-4fc7-84a8-5b20e5be5870/scratchpad/`, alongside `ssr-flow-audit.mjs` / `ssr-flow-audit2.mjs` (findings 2, 14–16 server probes).
- In-tree (untracked, hunt convention): `packages/solid-web/test/hunt4-flow-asymmetry.spec.tsx`, `hunt4-isolated.spec.tsx` (findings 2, 14–16 client halves); `packages/solid-web/test/harness/hunt6-scenarios.tsx`, `test/server/hunt6-asym-gen.spec.tsx`, `test/server/hunt6-reject-gen.spec.tsx`, `test/hydration/hunt6-asym.spec.tsx`, `test/hydration/hunt6-defer-probe.spec.tsx` (findings 7, 11, 17, 21).
- Findings 3–6, 9, 10, 18–20, 22–30 were verified with ad-hoc `node -e` probes against the dists (not persisted).

## Suggested batching for fixes / issue filing

(Use the Class 3 design-question framing from the intent assessment for findings 3, 8, 12, 13, and the seed-render half of 6; everything else can assert the client/documented behavior as expected.)

1. **Reveal composite readiness** (1 + 13): one patch in `server/flow.ts` (`updateSelfMinimallyResolved` / composite `onResolved`), decide the natural-order contract against the docs.
2. **Reveal scope severing family** (12 + draft 43): port severing to `createErrorBoundary` and `createRevealOrder`; sequence after the draft-01 Part 2 `$df` queue, and fold finding 7's comment-scan fix into that same dom-expressions PR.
3. **Async-error parity** (3, 6, 14, 21 + client-side 20): one theme — error routing/serialization must match; 14 is a two-line `errored`-flag fix.
4. **Store/projection commit semantics** (4, 5, 18): port `reconcile`/`storeSetter` semantics into the server projection arms.
5. **Hydration-id parity** (9, 10, 11): small, independent, high leverage — each is a missed shim in `server/signals.ts`.
6. **Show/Match thenable** (2): route server `when` through the existing `ServerComputation` thenable handling.
7. **API-contract stubs** (8, 15, 16, 22–30): individually small; Portal (8) and Switch-null (15) first since they crash SSR.
