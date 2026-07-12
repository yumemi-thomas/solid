# Bug Hunt — Solid 2.0.0-beta.16 stores and projections

Date: 2026-07-10  
Branch/commit: `next` at `ef4d53ea`  
Scope: plain stores, writable derived stores, projections, reconciliation, `snapshot()`, and `deep()`

> **Re-verified 2026-07-11 against `next` `a51cac19` (2.0.0-beta.17)** with Node probes against the
> rebuilt dist: **finding 4 (non-canonical array-index writes) is fixed** by `fda28a90`
> (PR #2863, external hunt — draft `36-` removed). Findings 1, 2, 3, 5, 6a, 6b, 7, 8, and 9 all
> still reproduce; the `options?.key || "id"` truthiness (finding 2) is still verbatim at
> `projection.ts:54`. Note: beta.17's `3e18b8da` ($TRACK through store-in-store wrapper views,
> #2864) does **not** cover finding 7's metadata-only `$TRACK` gap.

This pass found **9 additional store/projection defects**. It intentionally excludes the findings
already documented in `HUNT-2.0-beta.15-wave2.md` and
`HUNT-2.0-beta.16-wave3.md`:

- Map/Set/Date store proxy crashes;
- keyless-leaf `reconcile()` notification loss;
- symbol keys dropped by object snapshots/store-to-store writes;
- own accessor setters being bypassed;
- `Object.freeze(store)` poisoning;
- draft row moves cloning edited subtrees;
- hydration dropping synchronous `ssrSource: "hybrid"` store/projection writes.

No source or test files were added or changed. Every finding below was reproduced with an isolated
Node probe against `packages/solid-signals/dist/dev.js`. Comparable store cases were also run
against Solid 1.9.14 in `hunt-1x-checks`.

## Baseline

The official focused suite is green, so these are coverage gaps rather than already-known test
failures:

```sh
cd packages/solid-signals
pnpm vitest run \
  tests/store/createStore.test.ts \
  tests/store/createProjection.test.ts \
  tests/store/createProjection.async.test.ts \
  tests/store/createProjection.jsdom.test.ts \
  tests/store/reconcile.test.ts \
  tests/store/utilities.test.ts \
  tests/store/storePath.test.ts
```

Result: **204 passed, 0 failed**.

## Findings

### 1. Projection drafts do not preserve nested proxy identity — P1, 2.0-only

Repeated reads of the same object from a projection draft return a fresh proxy every time. This
breaks standard identity-based array methods inside the canonical mutation callback:

```ts
createProjection(draft => {
  draft[0] === draft[0];       // false
  draft.includes(draft[0]);    // false
  draft.indexOf(draft[0]);     // -1
}, [{ id: 1 }]);
```

The same operations inside a plain `createStore` setter correctly produce `true`, `true`, and `0`.

Realistic impact:

```ts
createProjection(draft => {
  const selected = draft.find(row => row.id === selectedId());
  if (selected && draft.includes(selected)) {
    // This branch never runs, even though `selected` came from `draft`.
  }
}, rows);
```

Root cause: `packages/solid-signals/src/store/projection.ts:162-174` wraps every object-valued `get`
in a new uncached `Proxy`:

```ts
return typeof value === "object" && value !== null ? new Proxy(value, traps) : value;
```

The projection wrapper already has a `wrappedMap` for store proxies, but the write-draft proxy
layer does not cache its nested wrappers.

### 2. `options.key: ""` is ignored and silently replaced by `"id"` — P2, 2.0-only

An empty string is a valid JavaScript property key and is accepted by the public `ProjectionOptions`
type. Passing it as the reconciliation key does not work:

```ts
const projected = createProjection(
  () => rows(),
  [],
  { key: "" }
);
```

With rows keyed as `{ "": "a" }` / `{ "": "b" }`, reordering `[a, b]` to `[b, a]` updates the
visible values but does not move the existing proxies with their logical rows. Both identity checks
fail:

```text
projected[0] === previousB  false
projected[1] === previousA  false
```

Root cause: `packages/solid-signals/src/store/projection.ts:54` uses truthiness instead of a nullish
default:

```ts
runProjectionComputed(wrappedStore, fn, options?.key || "id");
```

The same pattern exists in the derived optimistic-store path. Use `options?.key ?? "id"` so every
declared string key is honored.

### 3. `Object.defineProperty()` on a projection draft reports success but does nothing — P2, 2.0-only

Plain store drafts explicitly support descriptor writes. Projection drafts silently lose them:

```ts
const projected = createProjection(draft => {
  const ok = Reflect.defineProperty(draft, "added", {
    value: 2,
    enumerable: true,
    configurable: true,
    writable: true
  });

  console.log(ok);          // true
  console.log(draft.added); // undefined
}, {});

console.log("added" in projected); // false
```

Root cause: the projection handler at
`packages/solid-signals/src/store/projection.ts:157-213` implements `get`, `has`, `set`, and
`deleteProperty`, but no `defineProperty` trap. The operation forwards to the underlying store
proxy without enabling the projection write override. That proxy returns `true` while skipping the
write because it is outside its recognized write scope.

This also bypasses the async projection's stale-write guard and `onDraftWrite` hook.

### ~~4. Numeric-looking named array properties incorrectly change `length`~~ — resolved in beta.17 (`fda28a90`, PR #2863)

Was: store array writes classified every non-symbol non-`length` property as an array index via
`parseInt()`, so named props like `"01"` corrupted `length`. Fixed upstream with a canonical
array-index check; probe confirms `length` stays `0`.

### 5. Store array `length` bypasses JavaScript coercion and validation — P1, regression

Writing `length` through a store draft accepts states that a real array must reject, and does not
coerce valid string values:

| Write | Solid 2 result | Native / Solid 1.9.14 result |
|---|---|---|
| `draft.length = -1` | stores `-1` | throws `RangeError` |
| `draft.length = 1.5` | stores `1.5` | throws `RangeError` |
| `draft.length = "2"` | stores string `"2"` | stores number `2` |

The corrupted negative/fractional lengths later make `snapshot(store)` throw `RangeError: Invalid
array length`, moving the failure far away from the bad write.

Root cause: the `set` trap at `packages/solid-signals/src/store/store.ts:633-663` writes the raw
unwrapped value to the override object instead of applying the array `length` setter's ToUint32
coercion and validity check.

### 6. Returning an array from a store setter does not preserve its property shape — P1/P2

The documented array replacement path copies every numeric position and then assigns `length`:

```ts
if (Array.isArray(value)) {
  for (let i = 0; i < value.length; i++) store[i] = value[i];
  store.length = value.length;
}
```

This creates two observable defects.

#### 6a. Sparse arrays are densified — P1, regression

```ts
const [list, setList] = createStore([1, 2]);
const next = new Array(2);
next[1] = 2;

setList(() => next);
flush();

0 in list;          // true — should be false
Object.keys(list);  // ["0", "1"] — should be ["1"]
```

Reading a hole as `value[i]` produces `undefined`, then assigning it creates a real property. Solid
1.9.14 preserves the hole for the equivalent root replacement.

#### 6b. Named and symbol array properties are ignored — P2, long-standing

New metadata is not added, changed metadata remains stale, and removed metadata is not deleted:

```ts
const meta = Symbol();
const next = Object.assign([2], {
  label: "new",
  extra: "added",
  [meta]: "new-symbol"
});

setList(() => next);
```

Observed from a store initially carrying old metadata:

```text
list.label  "old"
list.extra  undefined
list[meta]  "old-symbol"
```

Root cause for both manifestations:
`packages/solid-signals/src/store/store.ts:825-835` special-cases arrays by index instead of diffing
their full enumerable own-key set. The metadata behavior also exists in 1.9.14; sparse-array
densification is a 2.0 regression.

### 7. `reconcile()` leaves tracked array metadata permanently stale — P1, long-standing and worse in 2.0

Array reconciliation swaps `STORE_VALUE` and updates numeric slots/length, but does not update
tracked named or symbol property nodes. It also does not notify `$TRACK` when only array metadata
changes.

```ts
const initial = Object.assign([1], { label: "old" });
const [list, setList] = createStore(initial);
const label = createMemo(() => list.label);
const keys = createMemo(() => Object.keys(list).join(","));

const next = Object.assign([1], { label: "new", extra: "added" });
setList(reconcile(next, "id"));
flush();
```

Observed:

```text
label()                    "old"
list.label                 "old"          // poisoned by stale property node
keys()                     "0,label"
Object.keys(list)          ["0","label","extra"]
list.extra                 "added"
```

The same proxy simultaneously exposes old tracked values and the new enumerated shape.

Root cause: the array branches in `packages/solid-signals/src/store/reconcile.ts:168-270` and
`:307-423` only reconcile numeric positions and length. `syncArrayNodeMembership()` updates a
property node only when the key disappears; it never updates a present named key's value. The
`changed` flag ignores metadata-only changes, so `$TRACK` is not notified.

Solid 1.9.14 also fails to invalidate the memo, but a direct `list.label` read returns `"new"`.
Solid 2.0 is worse because the stale node cache poisons subsequent direct reads too.

### 8. `snapshot()` / `deep()` array cloning fills holes and drops metadata — P1, regression/extension

Once an array store has any override, `snapshotImpl()` creates `result = []`, walks every integer
from `0` to `length - 1`, and writes every slot because `result` is truthy. This converts all holes
to real `undefined` properties:

```ts
const source = new Array(3);
source[2] = 3;
const [list, setList] = createStore(source);

setList(draft => { draft[2] = 4; });
flush();

const copy = snapshot(list);
0 in copy;          // true — should be false
1 in copy;          // true — should be false
Object.keys(copy);  // ["0", "1", "2"] — should be ["2"]
```

`deep()` produces the same dense result.

The same array-only loop ignores named and symbol properties. After an unrelated index write,
`snapshot()` of an array carrying `label` and `[symbol]` returns only indices and `length`; both
metadata values disappear. Symbol loss overlaps wave 2 finding 3, but named array metadata is an
additional data-loss path.

Root cause: `packages/solid-signals/src/store/utils.ts:61-74` iterates by length and assigns when
`result` exists, without testing `i in override || i in item`, and never enumerates non-index array
keys.

Solid 1.9.14 `unwrap()` preserves sparse membership. The 2.0 `snapshot()` implementation therefore
regresses hole semantics while introducing its distinct-copy behavior.

### 9. `snapshot()` breaks root self-cycle identity after a write — P1, regression

The cycle map is keyed first by the store proxy, then recursion encounters the raw source object.
That raw source is treated as a second root and receives a second clone:

```ts
const source: any = { value: 1 };
source.self = source;

const [state, setState] = createStore(source);
setState(draft => { draft.value = 2; });
flush();

const copy = snapshot(state);

copy.self === copy;           // false — graph identity corrupted
copy.self.self === copy.self; // true — cycle moved to the second clone
```

Both clones contain the updated value, so ordinary deep equality can miss the corruption.

Root cause: `packages/solid-signals/src/store/utils.ts:43-59` records the initial proxy in `map`,
then replaces `item` with `target[STORE_VALUE]` without also mapping that raw source to the same
result. Recursive lookup of `self` creates another result object.

Solid 1.9.14 `unwrap()` preserves `copy.self === copy`. The explicit cycle map in `snapshotImpl`
also indicates that preserving alias/cycle topology is intended.

## Priority for the beta

1. Fix projection draft identity (#1). `indexOf`/`includes` are normal mutation tools, and their
   failure makes otherwise idiomatic projection callbacks silently branch incorrectly.
2. Fix invalid array lengths (#5), returned sparse arrays (#6a), and snapshot/deep sparse arrays
   (#8). These violate core JavaScript array invariants and can turn a successful write into a
   later serialization crash.
3. Fix reconcile metadata poisoning (#7) and snapshot cycle topology (#9). Both make different
   observation paths disagree about the same store graph.
4. Address the lower-frequency API edges (#2, #3, #6b) before RC or explicitly narrow the
   supported draft/property semantics in types and documentation. (#4 fixed in beta.17.)

## Upstream duplicate check

Public GitHub searches on 2026-07-10 found no exact Solid issue for projection draft identity,
sparse `snapshot()` densification, invalid store array lengths, non-canonical array-index writes,
or array metadata reconciliation. The results only surfaced the general Solid 2 beta/Road to 2.0
discussions. These findings appear issue-ready, subject to a maintainer-side tracker search because
new issue creation is currently restricted.
