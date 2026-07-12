# 2.0.0-beta.17: hydration loses serialized `null` / `undefined` values and exposes the resolved async envelope instead

### Describe the bug

During hydration, a serialized `null` or `undefined` is not treated as an authoritative server value.

There are two manifestations of the same `readHydratedValue()` bug:

1. A direct serialized `null` is treated as though no entry were serialized at all. Solid runs the client compute instead, which can change the initial DOM and run client-only work during hydration.
2. A resolved async serialization `{ s: 1, v: null }` returns the envelope object itself rather than its resolved `null` value. The same applies to `v: undefined`.

The second manifestation is the most visible one in practice: an async memo that legitimately resolves to `null` on the server — "no active coupon", "no avatar set", "search matched nothing" are all ordinary results — hands its client consumers `{ s: 1, v: null }` instead of `null`, so every `value == null` check downstream is wrong after hydration.

### Your Example Website or App

_StackBlitz link to be added — paste the code below into `src/repro.tsx` of the standard SolidJS Vite template (`solid-js@2.0.0-beta.17`, `@solidjs/web@2.0.0-beta.17`, `jsxImportSource: "@solidjs/web"`) and load it as the entry module; it logs `PASS`/`FAIL` with expected vs actual to the browser console. No `index.html` markup is needed._

The repro drives the client hydration runtime through `sharedConfig`, which is a public export of `solid-js` — `startHydration()` injects exactly the serialized envelope format the server emits (`{ v: ..., s: 1 }` for a resolved async value, or the raw value itself for a direct serialization). It then creates a memo in the matching owner slot (`createRoot(..., { id: "t" })` puts the memo at `t0`) and checks what the accessor returns.

```tsx
import { createMemo, createRoot, flush, sharedConfig } from "solid-js";

let hydrationData: Record<string, any> = {};
function startHydration(data: Record<string, any>) {
  hydrationData = data;
  sharedConfig.hydrating = true;
  (sharedConfig as any).has = (id: string) => id in hydrationData;
  (sharedConfig as any).load = (id: string) => hydrationData[id];
  (sharedConfig as any).gather = () => {};
}

let result: unknown;

// Case 1: resolved async envelope — the server's async memo resolved to null
// ("no active coupon"), serialized as { v: null, s: 1 }.
startHydration({ t0: { v: null, s: 1 } });
createRoot(() => {
  result = createMemo(() => "client")();
}, { id: "t" });
flush();
console.log(
  "memo adopts serialized null:",
  result === null ? "PASS" : `FAIL — expected null, got ${JSON.stringify(result)}`
);

// Case 2: direct serialized null — the value itself was serialized as null.
startHydration({ t0: null });
let calls = 0;
createRoot(() => {
  result = createMemo(() => {
    calls++;
    return "client";
  })();
}, { id: "t" });
flush();
console.log(
  "direct serialized null adopted:",
  result === null ? "PASS" : `FAIL — expected null, got ${JSON.stringify(result)}`
);
console.log(
  "client compute skipped during hydration:",
  calls === 0 ? "PASS" : `FAIL — expected 0 calls, got ${calls}`
);
```

### Steps to Reproduce the Bug or Issue

1. Load the page with the repro module and open the browser console.
2. The repro starts hydration with a resolved async envelope whose value is `null` (`{ v: null, s: 1 }` at slot `t0`) and reads a memo created in the matching owner slot.
3. It then repeats with a direct serialized `null` at the same slot, counting how often the client compute runs.
4. On 2.0.0-beta.17 the browser console logs:

```text
memo adopts serialized null: FAIL — expected null, got {"v":null,"s":1}
direct serialized null adopted: FAIL — expected null, got "client"
client compute skipped during hydration: FAIL — expected 0 calls, got 1
```

The resolved-envelope case leaks the envelope object to the memo's consumers; the direct case discards the server value entirely and runs the client compute during hydration.

### Expected behavior

Hydration preserves server values exactly, including `null` and `undefined` — `{ s: 1, v: null }` yields `null`, `{ s: 1, v: undefined }` yields `undefined`, a direct serialized `null` remains `null` — and no client compute runs merely because the server value is nullish:

```text
memo adopts serialized null: PASS
direct serialized null adopted: PASS
client compute skipped during hydration: PASS
```

### Screenshots or Videos

_No response_

### Platform

- OS: macOS
- Browser: Chrome
- Version: 2.0.0-beta.17 (re-verified at `next` @ `a51cac19`)

### Additional context

Root cause: `readHydratedValue()` in `packages/solid/src/client/hydration.ts:270-274` uses nullish checks both to decide whether an entry exists and to unwrap the success envelope:

```ts
if (initP == null) return NO_HYDRATED_VALUE;
return initP?.v ?? initP;
```

`sharedConfig.has(id)` has already established whether an entry exists, so entry existence must not be inferred from its value — a direct serialized `null` currently reads as "no entry". And a successful envelope should be unwrapped based on its status (`s`), rather than using `??` on `v` — `v: null` / `v: undefined` currently falls through to returning the envelope object itself.

This affects every hydration-aware primitive path that calls `readSerializedOrCompute()`: memo, signal, optimistic signal, store, projection, and effect.

## Does this exist in Solid 1.x?

**Not applicable — new 2.0 API.** This lives in Solid 2.0's new hydration-aware primitive implementation (`readSerializedOrCompute()` / `readHydratedValue()`); 1.x has no equivalent serialized-primitive path.
