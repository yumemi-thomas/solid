# Issue Triage Log

Tracks issues/PRs we've made decisions on, with the responses we posted (or drafted). Entries marked CLOSED/DONE have had their responses posted publicly.

> Working notes. Not part of the published package.

---

## #2766 — Cleanup returned from nested `onSettled` runs immediately

- **Reporter:** yumemi-thomas (filed against beta.14)
- **PR:** #2782 (brenelz/tsushanth) — **rejected and closed** (July 1)
- **State:** DONE — fix landed (changeset `fix-onsettled-unowned-cleanup.md`), response posted July 1, issue closed

### Decision

The reporter's framing ("the inner cleanup should defer to the surrounding owner's disposal") is **not** the right model, and PR #2782's fix (capture the children-forbidden owner, run cleanup on *its* disposal) manufactures a lifecycle tie the primitive never established.

`onSettled` has two shapes behind one name: an **owned** lifecycle form (component body — fires after settle, cleanup on disposal, via `createTrackedEffect`) and an **unowned** out-of-band one-shot (event handler / forbidden owner — fire-and-forget, no lifecycle). A returned cleanup only has meaning in the owned form. In the unowned form there is no owner lifecycle to bind to, so binding to the nearest ancestor is surprising (it could outlive the one-shot fire by an arbitrary amount) and running it eagerly is useless (sets up then tears down in the same flush — the reported symptom).

Key finding: the reporter's actual goal — "wait until settled, then install a subscription that lives until disposal" — is **already** served by a plain owned `onSettled` called directly from the component body. It inherently waits for settle *and* ties cleanup to disposal. The outer `onSettled` wrapper adds zero delay and is the only thing pushing the inner call out-of-band. (Verified empirically: direct owned call → `subscribed` after settle, `unsubscribed` on dispose; nested → `subscribed`+`unsubscribed` in the same flush.)

We do **not** split the primitive (keep the surface tight). The cleanup affordance is just made honest about its precondition. Resolution = **dev-mode error, drop in production**, mirroring the existing `CLEANUP_IN_FORBIDDEN_SCOPE` precedent for `onCleanup`. Chose error over warn because a returned cleanup here is categorically invalid ("would restrict it with TS if we could"); chose dev-only (prod drops, no throw) to avoid an out-of-band crash in the effect queue. New diagnostic `SETTLED_CLEANUP_UNOWNED`.

### Drafted response (NOT posted)

> You're right that running the cleanup immediately is wrong — but deferring it to the surrounding owner's disposal (as the linked PR does) isn't the fix either. When `onSettled` fires out of band — from inside another `onSettled`, a tracked effect, or an event handler — there's no owner lifecycle for a returned cleanup to bind to, and binding it to an unrelated ancestor would be surprising.
>
> The thing is, your actual goal is already covered: a plain `onSettled` called directly from the component body *already* waits for the graph to settle **and** ties its returned cleanup to disposal. So `useSubscription()` works exactly as you want when called directly:
>
> ```tsx
> function Component() {
>   useSubscription(); // onSettled inside fires after settle, cleanup on dispose
> }
> ```
>
> The outer `onSettled` wrapper doesn't add any delay (both fire after the same settle) — it just pushes the inner call out of band, which is what strips the lifecycle. We're making that explicit: in the next beta, returning a cleanup from an `onSettled` that runs in an unowned scope is a dev-mode error pointing you to call your setup helper from an owned scope (it's dropped in production). One-shot post-settle work without a cleanup (e.g. `onSettled(() => toast("Saved!"))` in a handler) is unchanged.

---

## #2802 — Errors in reactive reads always propagate even if handled logically

- **Reporter:** dangkyokhoang
- **State:** CLOSED July 2. Claim #2 resolved as **unsupported pattern**, not a bug: the reporter's follow-up test read `count()` *after* an `await` inside the async compute. Reactive reads are only supported in the synchronous portion (that's where tracking happens); post-`await` reads are untracked outside reads, and seeing the pre-commit value while a transition holds the write is transition semantics working as intended. No runtime guard is practical (no shipped AsyncContext — "if we could make it throw, we would"); guidance deferred to future **lint tooling**. Correct pattern: read deps before the first `await`, carry as locals.
- **Repro:** https://stackblitz.com/edit/nitrojs-nitro-1w8mivtu?file=src%2FApp.tsx
- **Related:** discussion #2791

### Decision

Three separate questions are bundled in this issue:

1. **Error propagation to dependents (Claim #1) — by design.** An uncaught error travels to the nearest parent error boundary (`<Errored>` / `createErrorBoundary`); with no boundary it throws through (React-style crash). Verified all four quadrants — sync/async source × boundary/no-boundary — behave consistently (caught when a boundary exists, thrown through when none). Error handling is the boundary's job, not the individual dependent's. Nuance: a dependent reading an **async** source surfaces the error via the read, so a `try/catch` in that compute *can* intercept it; a **sync** source push-marks dependents directly, bypassing their compute.

2. **`isPending(data)` inside `<Errored fallback>` — already fixed (#2790).** `isPending` of an errored source now reads `false` and no longer loops/propagates. Fixed on `main`, not in beta.15; lands in the next beta.

3. **Stale async reads after recovery (Claim #2) — could not reproduce.** Rebuilt the sync→stringified→async-memo chain several times on both `next` and beta.15; async memos always recovered with fresh values after the sync source recovered. Need the reporter's exact repro against the next beta (post-#2790) to pin it.

### Drafted response (NOT posted)

> Thanks for the detailed write-up and the repro. A few things to untangle here, because there are really three separate questions bundled together.
>
> **1. Error propagation to dependents (Claim #1) — this is by design.**
>
> When a reactive read throws, the error propagates to dependents and marks them errored rather than re-running each dependent's compute and expecting it to `try/catch`. The contract is: an uncaught error travels to the **nearest parent error boundary** (`<Errored>` / `createErrorBoundary`), and **if there is no boundary, it throws through** (crashing, the same way React behaves with no boundary). We verified all four quadrants — sync source and async source, each with and without a boundary — and they behave consistently: caught by the boundary when one exists, thrown through when none does.
>
> So to your question — *"how can I depend on a reactive value without the risk of error propagating?"* — the intended answer is that error handling is the boundary's job, not the individual dependent's. A dependent isn't meant to locally swallow an upstream error and carry on; that's what the boundary is for.
>
> One nuance worth noting: a dependent reading an **async** source surfaces the error via the read itself, so a `try/catch` *in that compute* can intercept it. A **sync** source push-marks dependents directly, bypassing their compute — which is the behavior you observed.
>
> **2. The motivating `isPending(data)` inside `<Errored fallback>` — already fixed.**
>
> The fallback case you show:
>
> ```tsx
> <Errored fallback={(err, reset) => <button onClick={reset} disabled={isPending(data)}>Reset</button>}>
> ```
>
> `isPending` reading an errored source used to misbehave (it could loop). That's been fixed on `main` — `isPending` of an errored source now reads `false` and does not propagate the error or loop. It's not in beta.15, but will be in the next beta. So this specific pattern works.
>
> **3. Stale async reads after recovery (Claim #2) — we couldn't reproduce.**
>
> We rebuilt the chain several times (sync → stringified → async memo, with the sync source erroring then recovering) on both `next` and beta.15, and in every case the async memos recovered with fresh values after the sync source recovered — no staleness or lingering error. So either there's a subtlety in your exact setup we're not capturing, or it's downstream of the beta.15 `isPending` bug above. Could you confirm whether the StackBlitz still shows stale async reads against the next beta once it's out, and if so trim it to the smallest chain that still reproduces? That'll let us pin it precisely.

---

## #2761 — One throwing effect can kill all reactivity

- **Reporter:** yumemi-thomas (filed against beta.14)
- **State:** CLOSED July 2 — resolved by the **reactivity killswitch** (`90238e79`), which superseded the teardown direction below. An error escaping every boundary now permanently halts the scheduler (`REACTIVITY_HALTED` logged; later writes ignored with a console notice). The accidental stall is now a deterministic, loud, by-design halt. Response posted.

### Decision

Two distinct freeze paths behind the same symptom:

1. **`flush(fn)` syncDepth leak — fixed in beta.15** (`f0bdfad8`): the counter is balanced in a `finally`, covered by the flush.test.ts syncDepth test.
2. **Microtask-driven flush, write-then-throw — REAL, verified (July 1).** tsushanth's mechanism is exactly right: the effect's write calls `schedule()` while `_running` is set, so it only marks `scheduled = true` without arming; the throw unwinds `GlobalQueue.flush`, and every later `schedule()` short-circuits on the stuck flag. Frozen until a manual `flush()`. Reproduced for both user and render effects. (Testing trap for the future: a stale microtask armed during graph creation acts as an accidental recovery flush and masks the freeze — the repro must drain microtasks *before* triggering.)

**We are deliberately NOT landing his proposed re-arm fix** (re-queue the flush microtask in the `finally`/on abnormal exit). We built it, it works, and we reverted it — because it is precisely the "drain-and-rethrow via re-armed microtask" option already **rejected** in the #2762 entry: the recovery flush runs the abandoned remainder of a broken tree, limping it along instead of surfacing the failure. It would also become dead code under the real fix.

The real fix is the tracked **teardown work** (shared with #2762): an unhandled effect error disposes the owning root instead of unwinding the flush. The exception then never escapes `GlobalQueue.flush`, so the stuck-`scheduled` state cannot arise — the freeze path is removed structurally, not patched.

### Drafted response (NOT posted, revised July 1 to engage tsushanth's comment)

> @tsushanth your analysis is correct, and thanks for the precise trace — we reproduced it exactly as described (one detail for anyone re-testing: you have to drain creation-time microtasks before triggering, or a stale queued flush masks the freeze by accidentally rescuing it).
>
> So the state on this issue: beta.15 fixed the `flush(fn)` sync-depth leak from the original report, but the microtask-path freeze you found is real and remains.
>
> That said, we're deliberately not taking the re-arm fix. We prototyped it and it does unfreeze the scheduler — but the recovery flush then drains and runs the abandoned remainder of a tree that just threw an unhandled error, which is the "limp the broken tree along" behavior we've explicitly decided against (see #2762). The direction we're committed to is React-style teardown: an unhandled effect error disposes the owning root (with the renderer unmounting its DOM), so the error never unwinds the flush at all — surviving roots keep running, and this stuck-flag state becomes structurally impossible rather than patched around. The re-arm would be dead code the moment that lands.
>
> Folding the remaining path into that tracked teardown work alongside #2762. Until it lands, the guidance stands: effect errors should be handled by an error boundary; an uncaught one is fatal to that scope by design.

---

## #2762 — A throwing effect abandons later queued siblings

- **Reporter:** yumemi-thomas (filed against beta.14)
- **State:** CLOSED July 2 — same resolution as #2761 (killswitch, `90238e79`). Siblings behind an unhandled thrower intentionally never run: post-error state is undefined, so the system halts rather than draining. We ultimately chose the halt over the root-teardown design sketched below (simpler, total, no half-alive app). Response posted.

### Decision

Not a bug we patch the way it's reported. We built and deliberately **dropped** both candidate fixes:

- **Run siblings anyway** — rejected. Under "an effect threw with no boundary, we're cooked," silently running the rest of a broken tree is the wrong default.
- **Drain-and-rethrow via re-armed microtask** — rejected. It limps the broken remainder along, defeating the point of surfacing the error.

The correct long-term answer is **React-style teardown on unhandled error**: route a no-boundary throw to dispose the owning root (with `@solidjs/web` doing the DOM unmount and surviving-root isolation), so the dead scope leaves the scheduler entirely rather than abandoning or nursing siblings. This is a tracked, larger design effort — not a scheduler micro-patch. Consistent with the #2802 model (boundary catches; otherwise throw-through, and eventually a clean teardown of the dead scope).

### Drafted response (NOT posted)

> The sibling-abandonment here is real, but the fix isn't to keep running the rest of the batch after an effect throws with no boundary — continuing a broken tree is the wrong default. The intended direction is teardown: an unhandled effect error disposes the owning root (React-style), removing the dead scope from the scheduler entirely rather than partially draining it. That's tracked as a larger piece of work. For now, the guidance is that effect errors should be handled by an error boundary (`<Errored>` / `createErrorBoundary`); an uncaught one is treated as fatal to that scope by design.

---

## PR #2783 — surface sync rejection from thenables (closes #2764)

- **Author:** tsushanth
- **State:** DONE — core fix landed separately (changeset `fix-sync-rejecting-thenable.md`); comment posted and PR closed July 1

### Decision

The **#2764 portion** is correct and matches what we'd write: capture a synchronous rejection in the thenable branch (mirroring the existing sync-resolve handling) and settle it via `handleError` so `<Errored>` sees it instead of the node staying stuck on the pending path. We landed an equivalent fix on `next` with a regression test in `syncThenable.test.ts`.

We did **not** merge the PR because it also rewrites `onSettled` in `signals.ts` using the *defer-cleanup-to-owner-disposal* approach (`runWithOwner(capturedOwner, …)`) — i.e. the #2766 design we explicitly **rejected** (see the #2766 entry above). That conflicts with the dev-error/prod-drop contract we already shipped, and the PR is also based on a pre-#2766/#2806 tree, so it no longer applies cleanly.

### Drafted response (NOT posted)

> Thanks for this — the sync-rejection diagnosis is exactly right. A thenable that rejects synchronously during `.then()` was having its error dropped (the reject handler only acted in the async case), so the node stayed pending and `<Errored>` never fired. We've landed an equivalent fix on `next`: the thenable branch now captures a synchronous rejection alongside the sync-resolve path and settles it, with a regression test.
>
> One thing we can't take from this PR is the bundled `onSettled` change. We resolved #2766 with a different contract — returning a cleanup from an `onSettled` that runs in an unowned scope is a dev-mode error (dropped in production), rather than deferring the cleanup to the surrounding owner's disposal — so the two approaches conflict. Since the thenable fix is already in, I'll close this; the credit for the #2764 diagnosis is yours.

---

## PR #2785 — await non-Promise thenables yielded from action (closes #2765)

- **Author:** tsushanth
- **State:** DONE — core fix landed separately (changeset `fix-action-thenable-await.md`); comment posted and PR closed July 1

### Decision

The **#2765 portion** is correct (and the right shape): replace the `instanceof Promise` gate with a thenability check applied at both yield sites, matching `await` semantics. We landed an equivalent fix on `next` (an `isThenable` helper) with a regression test in `action.test.ts`.

We did **not** merge the PR because it also bundles a `map.ts` `_offset = 0` change for **#2767**, which is **already landed** on `next` (`d8921ac1`) — the current `map.ts` has the identical reset. That portion is redundant, and the PR is based on an older tree.

### Drafted response (NOT posted)

> Good catch — `action()` only awaited native `Promise` instances, so a yielded thenable that wasn't `instanceof Promise` resumed the generator with the raw object instead of its settled value. We've landed an equivalent fix on `next`: yield handling now uses a thenability check (`typeof value.then === "function"`) at both sites, matching how `await` treats thenables, with a regression test.
>
> The `map.ts`/repeat change bundled here is already on `next` (the `_offset` reset from the earlier repeat fix), so there's nothing to take there. Closing since the action fix is in — thanks for the thenable fix.

---

## Closed July 2 (responses posted)

- **#2813** — throwing effect cleanup wedges its effect. Fixed in `90238e79`: cleanups detached before invocation, run inside the effect's `try` (boundary-catchable, strict-read guard restored). Same reorder in `trackedEffect` and the errorFn reset callback. CLOSED with response.
- **#2761 / #2762** — resolved by the reactivity killswitch in `90238e79` (see entries above). CLOSED with responses.
- **PR #2814** (yumemi-thomas) — contain-and-drain approach to #2761/#2762/#2813. #2813 portion credited (matches what landed); containment half declined on philosophy: unhandled errors halt, they don't route around. CLOSED with response.
- **#2779** — server `dynamic()` Promise sources. Fixed both sides: `dynamic()` rework on `next` (commit `be9a07a6`) + awaited-stream root-holes fix in `@dom-expressions/runtime` 0.50.0-next.15. CLOSED with response.
- **#2815** — SSR drops function-source spreads. Fixed upstream (runtime next.15 sources `mergeProps` from core); regression tests committed on `next`. CLOSED. **PR #2816** closed as superseded by the upstream fix, with credit.
- **#2790** — `isPending()` in `Loading > Errored` fallback loop. Fixed by the errored-read gating + boundary notify-through work (also resolved #2809). CLOSED with response.
- **#2802** — see entry above (read-after-await pattern). CLOSED July 2.

---

## Closed July 7 (responses posted)

- **#2850** — snapshot/deep optimistic overlay. Fixed `461b2423`. CLOSED with response (entry below).
- **PR #2756** — signals hot-path perf. Safe subset landed. CLOSED with credit (entry below).
- **#2801** — six-bug hydration report. All dispositioned; dom-expressions `0.50.0-next.16` published, dep bumped (`f6a35404`), link overrides dropped. CLOSED with per-bug summary.
- **#2737** — spread + innerHTML after hydration. Verified never affected 2.0; pinned by `spread-innerhtml.spec.tsx` (`bad66625`). CLOSED (2.0 covered; 1.x critical-fixes-only).
- **#2830 / #2832 / #2833** — fixes already on `next` with responses posted July 6; closed now that the `.16` runtime is published and depended on.
- **#2828** — style differ (explicit-`undefined` removal, user-object mutation, shared-effect self-destruct). Fixed by dom-expressions#534 (`node._$styles` applied-record diff), shipped in `.16`. CLOSED with response crediting yumemi-thomas.
- **#2843** — isPending/latest scheduler loop. Fixed structurally by the #2838 companion redesign; exact repro re-verified on current tree and pinned in `scheduler-livelock.test.ts` (`c24f5a53`). CLOSED with response.
- **PR #2845** (yumemi-thomas) — `_deferRevert` approach to #2843. CLOSED with credit: 6 of 7 of its tests pass under the redesign without deferral machinery; the approach also violates the async-registration invariant. **Its 7th test flagged a real remaining edge: a source disposed mid-flight leaves its companion latched `true` — tracked, fix in-model (companion reverts on owner disposal).**
- **#2838** — write-driven shadow (our tracking issue). Both stages landed (`7de51bea`, `b51bbcc2`). CLOSED with status summary. Noted remaining cleanup: the `_parentSource !== el` read-ternary exemption and the `NotReadyError` catch in `read()`'s latest branch survive; suite passes without the former (probe, reverted) — queued for the next code-reduction pass with proper analysis.

---

## #2850 — `snapshot()` / `deep()` ignore optimistic writes on `createOptimisticStore`

- **Reporter:** brenelz
- **State:** CLOSED July 7 — fix landed (`461b2423`, changeset `fix-snapshot-optimistic-overlay.md`), response posted, issue closed.

### Decision

**Ruled (Ryan, July 7): include the overlay.** snapshot is primarily a reactive read feeding the front half of effects (which generally run post-settle anyway) — "sort of a deep untrack," and untrack strips tracking, not value selection. Supporting arguments that make it airtight:

1. **A17 uniformity** — while an override is active every reader sees it, and *no* read form strips an override (`untrack` doesn't; even `latest` doesn't — A20 classifies overrides as confirmation-uncertainty). A committed-value-peeking snapshot would be the only mask-bypassing read in the system.
2. **Regular-store precedent** — snapshot already reads the pending-write overlay synchronously (documented in `utilities.test.ts` as by-design). The optimistic overlay is the same concept under a different key; excluding it was the inconsistency.
3. **Serialization wants it too** — serializing inside an action (POST body from draft state) needs the draft, not stale committed data.
4. **Bounded divergence** — post-settle the overlay is gone and both answers agree; the window where this matters (transition) is exactly where lane render effects and action bodies read, and both want the optimistic view.

No snapshot/deep split (same impl, same answer). Implementation: `mergedOverlay(target)` in `snapshotImpl` — optimistic over regular, the same order as every proxy trap and `reconcile`; merge allocates only in the rare both-layers case. Also landed the `snapshotImpl` specialized no-overlay walk deferred from PR #2756 (this ruling unblocked it). 4 regression tests (direct write, transition+revert, nested/array/delete, `deep()` re-run cycle) — all fail without the fix.

Note: `unwrapStoreValue` (set-trap value extraction) still consults only `STORE_OVERRIDE` — deliberately untouched: writing another store's optimistic *guesses* into a target store's base data is a different semantic question than reading, and the guess would outlive its revert. Flag if it comes up.

### Drafted response (NOT posted)

> Good catch, and the framing in the root-cause section is exactly right — `snapshotImpl` was the one consumer of the three-layer store model that never learned about the optimistic overlay. Fixed on `next`: `snapshot()` and `deep()` now resolve values optimistic-overlay-first, the same order as the proxy traps and `reconcile`. The guiding rule is that an active optimistic write is *the* value for every reader — nothing in the read API peeks behind it — and snapshot on regular stores already read the pending-write overlay synchronously, so this brings optimistic stores in line with the documented behavior. Ships in the next beta.

---

## PR #2756 — perf: optimize signals hot paths

- **Author:** brenelz
- **State:** CLOSED July 7 — safe subset landed as `b7c03a7b`, re-implemented on the current tree (the June 12 diff predates `_pendingObserver` on links and two `setSignal` rewrites, so it no longer applied). The deferred `snapshotImpl` walk landed with the #2850 fix (`461b2423`). Response posted with credit, PR closed.

### Decision

Four optimizations reviewed individually:

1. **Gen-stamp dep revalidation — TAKEN.** His flamegraph diagnosis was right: `isValidLink` scans the dep list from the head on every non-consecutive re-read of a dep within one recompute pass — O(n²), 51% of the deep-reconcile bench. Links now carry `_gen` stamped from the subscriber's `_depGen` pass counter (bumped at recompute start alongside the `_depsTail = null` reset, so prefix membership ⇔ stamped-this-pass). `isValidLink` deleted. Verified on the current tree: deep-tree reconcile all-paths ~18.9ms → ~2.6ms (**7.3x**), single `deep()` effect ~9.7ms → ~1.8ms (**5.3x**), creation paths within noise.
2. **Reconcile/store allocation trims — TAKEN.** `getAllKeys` same-keys fast path, `unwrap` primitive early-return, `getKeys` untrack-closure skip for plain sources, cached bound effect runner (safe: `enqueue` has no identity dedupe and tracked effects already reuse one `_run`).
3. **`notifyEpoch` skip-walk — DECLINED.** Global cache-invalidation scheme whose correctness requires enumerating every notification-consumption path; a missed path is silently stale UI. It was already accreting escape hatches in June (optimistic always walks, `_snapshotValue` bypass) and the machinery it must not break (lanes, holds, gated subs, transition stash) has been rebuilt since. Its headline 24x is on `update1to1000` — same-signal-written-1000-times, not a real workload. If that bench ever matters, re-derive the invalidation set against the current scheduler as its own designed change.
4. **`snapshotImpl` specialized walk — DEFERRED.** Touches the function whose overlay semantics are pending the #2850 ruling; no point optimizing what may be rewritten.

Size cost of the taken subset: +140B min / +63B gz (new link/node fields minus the deleted scan) — accepted for the asymptotic win on store-heavy workloads.

### Drafted response (NOT posted)

> Great find on `isValidLink` — the head-scan on non-consecutive dep re-reads was exactly the right diagnosis, and it's the dominant cost in store-heavy recomputes (your 51% flamegraph number reproduced on our end). We've landed the gen-stamp revalidation plus the reconcile/store allocation trims (`getAllKeys` fast path, `unwrap` primitive early-return, `getKeys` untrack skip, cached bound runner) on `next`, re-implemented against the current tree since the branch predates a couple of `link()`/`setSignal` rewrites — with your numbers verified: ~7x on deep-tree reconcile with all paths subscribed, ~5x on a `deep()` effect.
>
> The one piece we deliberately didn't take is the `notifyEpoch` skip-walk. It's a global invalidation scheme where correctness depends on catching every path that consumes a queued notification, and a missed one means silently stale UI — and the scheduler internals it has to track (optimistic lanes, transition holds, gated subscribers) have been substantially rebuilt since June. The bench it targets (writing one signal 1000× in a batch) is also not a shape real apps hit. If that path ever shows up in real workloads we'd want to re-derive the invalidation set against the current scheduler as its own change. The `snapshotImpl` specialized walk landed alongside the #2850 fix (it was waiting on that ruling, since it touches the same function).
>
> Closing since the taken parts are in — thanks, this was a genuinely valuable profile-driven find.

---

## #2801 — "Many hydration bugs" (six-bug report)

- **Reporter:** dangkyokhoang
- **State:** ENGINEERING COMPLETE (July 3) — all real bugs fixed. Bug 2 landed as the **hole id scopes** design (dom-expressions: compiler `scope()` wrap keyed off the shared `dynamic` flag + runtime owner scopes; orderedInsert removed; ssr grouping restored). Bug 1's remaining pending-stream case fixed in dom-expressions runtime (`a92ddb53`): when a `$df` swap disconnects a hole's tracked nodes mid-hydration, `insert` re-claims the live region (parent children, or back to the matching `<!--$-->` for marker-bounded holes) so loose text re-claims positionally; `insert-refresh-drift.spec.tsx` `test.fails` flipped, `bounded-streamed-text` harness scenario added. Rust jsx-compiler ported (`1dbc91b6`): shared allocate/dynamic predicates, `scope()` emission in both generates, orderedInsert machinery dropped, fixtures re-blessed (note: local platform `.node` binaries from Jul 2 were stale and masking results — deleted; `jsx-compiler.node` debug build is authoritative locally). Streaming rendering example verified end-to-end (12/12 Playwright checks). Release steps done: dom-expressions `0.50.0-next.16` published, solid dep bumped, workspace link override dropped (`f6a35404`). CLOSED July 7 with per-bug summary.

### Per-bug disposition

| # | Verdict | Where | Status |
|---|---------|-------|--------|
| 1 | Real bug — tracked node drifts from real DOM node on refresh when async value sits directly beside siblings | solid-js `createLoadingBoundary` (hydration path), NOT dom-expressions | **FIXED (July 2, settled case)**. Repro: fragment children (`Count: {data()} <span>after</span>` under `Loading`, no wrapping element) + post-hydration refresh → duplicate text appended (`Count: 42 after43`). Root cause: a boundary whose serialized state was **already settled** (`s === 1`, content in the DOM) still rendered `fallback()` for one microtask before resuming into content. That phantom fallback (fresh detached client DOM, never inserted — inserts are no-ops while hydrating) clobbered insert's `current`, so the content pass fabricated detached text nodes and every later update reconciled against phantoms. Elements re-claim via `_hk` regardless, which is why only loose text beside siblings drifted, and only on refresh — the page always looked right. Fix (model per Ryan): **the fallback only hydrates if it is actually showing, i.e. `$df` hasn't happened** — settled boundaries now hydrate straight through to content in the same pass (`createLoadingBoundary`, both the sync-serialize and `_fr` channels; asset-gated boundaries keep the `undefined` + resume path). Changeset `fix-settled-boundary-fallback-hydration.md`; regression test `insert-refresh-drift.spec.tsx`; two `client-hydration.spec.ts` tests updated (they asserted the old fallback-first microtask behavior). **Still open (marked `test.fails`)**: genuinely-pending stream — fallback correctly hydrates, then `$df` swaps and the content pass has no way to re-claim loose text from the swapped-in fragment (`current` still points at the removed fallback; elements recover via `_hk`, text has no key). Fold into bug 2's claiming design |
| 2 | Real bug — `{cond && <jsx>}` before `<For>` numbers hydration keys differently on server vs client | Structural: hydration ids are temporal (`ownerId + childCount++`); the conditional's ids allocate *after* its NotReady retry, while eager siblings advance the shared counter (server h4=slot 4, client h4=slot 2 — traced). Predates the `35742284` perf pass (old compiler also allocated lazily); `9a64f1fa`'s orderedInsert thunking only fixes invocation order, not async-deferred allocation | **Fix direction agreed (July 2): compiler-assigned slot ids** — every dynamic child hole gets a compile-time slot number emitted into both generates; hole content derives ids from `parentId + slot` + local counter. Makes ids evaluation-order-independent, allows reverting orderedInsert thunking + widening ssrGroup. Design doc TBD in dom-expressions repo. Workaround: use `<Show>` |
| 3 | Was real — `Loading > Errored > nested async memo` hung SSR forever | solid-js server | **Already fixed at HEAD** by the #2790/#2809 error-propagation work; verified (settles, 1 fetch); permanent regression test added to `ssr-stream.spec.tsx` |
| 4 | Real bug — an effect reading an async memo hung SSR (infinite discovery loop, 143 re-fetches observed) | solid-js server (`serverEffect`) | **FIXED locally**: pending reads never throw through the render (that's what caused the boundary rebuild loop). Render effects register the pending source with `ctx.block()` — holding shell flush like top-level JSX async — and retry compute+effectFn once settled (chaining if still pending; real retry errors route to the boundary's ErrorContext handler). Plain `createEffect` is contained outright since its side effect never runs during SSR. Changeset `fix-server-effect-pending-read-loop.md` + 5 tests in `ssr-stream.spec.tsx` |
| 5 | Footgun, by design — app caches the hydration-time MockPromise | hydration design | No change. Ryan already answered in-thread: deps must be re-discovered on the client; don't cache promises created during the hydration render |
| 6 | Real bug — rendering a plain object crashes SSR (`node.fn` read on undefined), then client loops | dom-expressions server runtime (`tryResolveString`/`resolveSSRNode` treat any object as a template object; client dev-warns and skips) | **FIXED upstream July 2** (dom-expressions `7303ab62`): server now dev-warns and skips like the client; regression tests in runtime `ssr.spec.js`. Ships in next runtime release; verified end-to-end through solid-web before committing |
