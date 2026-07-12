# 2.0.0-beta.17: streaming SSR/client asymmetry — a nested `<Loading>` joins the ancestor `<Reveal>` group and delays its direct slots

### Describe the bug

In Solid 2.0.0-beta.17 streaming SSR, a `<Loading>` boundary nested **inside** another `<Loading>` boundary's content is registered into the ancestor `<Reveal>` group as if it were a direct slot:

1. The repro has two direct slots under `<Reveal order="together">`: product details resolve at ~10ms and reviews at ~40ms. The product slot also contains a nested recommendations boundary that resolves at ~80ms and has its own fallback.
2. Under the client's direct-slot semantics, those two slots reveal together at ~40ms. The server instead generates a three-key group containing the two direct slots **and the nested boundary**, so both ready slots remain hidden until recommendations resolve at ~80ms.
3. The client behaves differently: a loading boundary clears the reveal context for its children, so the same nested boundary does not participate in the ancestor's group.

**Design question:** should a plain `<Loading>` nested inside a direct `<Loading>` child of `<Reveal>` participate in that ancestor's reveal group, or should the outer `<Loading>` isolate its subtree, as the client implementation currently does? SSR currently enrolls the nested boundary while the client does not, creating a server/client semantic asymmetry. This report uses the client/direct-slot behavior as the expected result, but the intended contract should be confirmed.

The same script first runs an otherwise-identical control without the nested recommendations boundary. That control produces the correct two-key group and reveals at ~40ms. Adding only the nested boundary changes the group to three keys and delays the activation until ~80ms.

This models a common product page: the main details and reviews reveal together, while a slower recommendations panel uses its own loading fallback. A slow descendant should not hold the entire page behind the outer fallbacks.

Related to but distinct from #2776 (rejected async boundary inside `<Reveal>` stalls sibling reveal during SSR streaming — closed, fixed in beta.17 by 4608539f): that issue was about error handling within a group; this one is about *group membership* — non-direct descendants being enrolled at all.

### Your Example Website or App

- [Server reproduction](https://stackblitz.com/edit/solidjs-templates-pabkbshg?file=src%2Frepro.tsx): the nested `<Loading>` joins the ancestor `<Reveal>` group.
- [Client comparison](https://stackblitz.com/edit/shzx7jmx?file=src%2FApp.tsx): the client isolates the nested `<Loading>` from the ancestor `<Reveal>` group.

Together these reproduce the server/client semantic asymmetry with the same product, reviews, and nested recommendations structure.

The repro checks three observable consequences:

- The ancestor `$dfj([...])` group contains exactly the two direct slots.
- That group activates before the slow nested recommendations template arrives.
- The nested boundary later activates independently with `$df(...)`.

```tsx
import { renderToStream } from "@solidjs/web";
import { createMemo, Loading, Reveal } from "solid-js";

const fetchIn = <T,>(value: T, ms: number): Promise<T> =>
  new Promise(resolve => setTimeout(() => resolve(value), ms));

async function streamPage(withRecommendations: boolean): Promise<string[]> {
  function Recommendations() {
    // This memo must be created below the nested Loading boundary. Creating it
    // in ProductDetails would not exercise nested-boundary ownership.
    const recommendations = createMemo(async () => fetchIn("Camp Stove", 80));
    return <span>{recommendations()}</span>;
  }

  function ProductDetails() {
    const product = createMemo(async () => fetchIn("Trail Pack", 10));
    return (
      <section>
        <h1>{product()}</h1>
        {withRecommendations && (
          <Loading fallback={<i>loading recommendations…</i>}>
            <Recommendations />
          </Loading>
        )}
      </section>
    );
  }

  function Reviews() {
    const reviews = createMemo(async () => fetchIn("4.8 stars", 40));
    return <aside>{reviews()}</aside>;
  }

  function App() {
    return (
      <Reveal order="together">
        <Loading fallback={<b>loading product…</b>}>
          <ProductDetails />
        </Loading>
        <Loading fallback={<b>loading reviews…</b>}>
          <Reviews />
        </Loading>
      </Reveal>
    );
  }

  const started = Date.now();
  return new Promise(resolve => {
    const chunks: string[] = [];
    renderToStream(() => <App />).pipe({
      write(chunk: string) {
        console.log(`--- chunk @ ${Date.now() - started}ms ---\n${chunk}`);
        chunks.push(chunk);
      },
      end() {
        resolve(chunks);
      }
    });
  });
}

function inspect(chunks: string[], withRecommendations: boolean) {
  const full = chunks.join("");
  const groups = [...full.matchAll(/\$dfj\((\[[^\]]*\])\)/g)].map(match =>
    JSON.parse(match[1]) as string[]
  );
  const groupChunk = chunks.findIndex(chunk => chunk.includes("$dfj"));
  const recommendationsChunk = chunks.findIndex(chunk => chunk.includes("Camp Stove"));
  const nestedTemplate =
    recommendationsChunk < 0
      ? undefined
      : chunks[recommendationsChunk].match(/<template id="([^"]+)"[^>]*>[\s\S]*Camp Stove/)?.[1];

  // Reveal has exactly two direct Loading children in both runs.
  const directSlotsOnly = groups.length > 0 && groups.every(keys => keys.length === 2);
  const groupWasNotHeld =
    !withRecommendations ||
    (groupChunk >= 0 && recommendationsChunk >= 0 && groupChunk < recommendationsChunk);
  const nestedRevealedIndependently =
    !withRecommendations ||
    (!!nestedTemplate && full.includes(`$df("${nestedTemplate}")`));

  return {
    ok: directSlotsOnly && groupWasNotHeld && nestedRevealedIndependently,
    groups,
    groupChunk,
    recommendationsChunk,
    nestedTemplate,
    groupWasNotHeld,
    nestedRevealedIndependently
  };
}

function report(label: string, result: ReturnType<typeof inspect>) {
  console.log(`\n${label}: ${result.ok ? "PASS" : "FAIL"}`);
  console.log("  ancestor groups:", JSON.stringify(result.groups));
  console.log(
    `  ancestor activation chunk: ${result.groupChunk}; recommendations chunk: ${result.recommendationsChunk}`
  );
  if (result.nestedTemplate) {
    console.log(
      `  nested ${result.nestedTemplate} revealed independently: ${result.nestedRevealedIndependently}`
    );
  }
}

const control = inspect(await streamPage(false), false);
const repro = inspect(await streamPage(true), true);

report("CONTROL — two direct slots", control);
report("REPRO — same page plus nested recommendations", repro);

console.log(
  control.ok && repro.ok
    ? "\nPASS — bug is fixed"
    : "\nFAIL — nested Loading joined the ancestor Reveal group"
);
```

The [server StackBlitz](https://stackblitz.com/edit/solidjs-templates-pabkbshg?file=src%2Frepro.tsx) runs `src/repro.tsx` through the server runtime (`vite-node` + `vite-plugin-solid` with `solid: { generate: "ssr", hydratable: true }`).

**Meta-framework confirmation — [TanStack Start × Solid 2.0 StackBlitz](https://stackblitz.com/edit/d6vtf1ou?file=src%2Froutes%2Findex.tsx)** ([launcher alternative](https://yumemi-thomas.github.io/solid-repros/launch.html?repro=draft-01-tanstack-start-reveal-nested-loading)): the same page in a real `@tanstack/solid-start@2.0.0-beta.24` app (official Solid 2.0 beta support). `npm start` streams a control route (2-key group, releases at ~800ms) and the repro route (3-key group, held to ~2500ms), prints the PASS/FAIL verdict in the terminal, and leaves the dev server running so the skeleton hostage is visible in the preview.

### Steps to Reproduce the Bug or Issue

1. Open the [server reproduction](https://stackblitz.com/edit/solidjs-templates-pabkbshg?file=src%2Frepro.tsx) terminal.
2. Run `npm run repro`.
3. On 2.0.0-beta.17, the control passes and adding only the nested boundary fails:

```text
CONTROL — two direct slots: PASS
  ancestor groups: [["00","01"]]
  ancestor activation chunk: 2; recommendations chunk: -1

REPRO — same page plus nested recommendations: FAIL
  ancestor groups: [["00","01","00003"]]
  ancestor activation chunk: 6; recommendations chunk: 5
  nested 00003 revealed independently: false

FAIL — nested Loading joined the ancestor Reveal group
```

4. The repro stream has this shape (generated scripts trimmed):

```text
--- chunk @ ~0ms ---
…loading product……loading reviews…

--- chunk @ ~11ms ---
<template id="00">…Trail Pack…loading recommendations…</template>

--- chunk @ ~41ms ---
<template id="01">…4.8 stars…</template>       ← both DIRECT slots are ready; no activation

--- chunk @ ~81ms ---
<template id="00003">…Camp Stove…</template>

--- chunk @ ~81ms ---
<script>…$dfj(["00","01","00003"]);…</script> ← nested key also joins the group
```

The two direct slots are ready at ~41ms, but the ancestor activation is not emitted until the nested recommendations boundary resolves at ~81ms. The nested boundary is then activated as part of the ancestor's three-key group instead of independently.

### Client comparison repro

The equivalent client render behaves differently. It reveals the two direct slots once reviews settle at ~40ms, while the nested recommendations boundary continues showing its own fallback until ~80ms.

Live comparison: [client StackBlitz](https://stackblitz.com/edit/shzx7jmx?file=src%2FApp.tsx).

Run this in the browser build of the same Solid 2.0.0-beta.17 app. It creates its own mount point and prints a visible three-step PASS/FAIL report:

```tsx
import { render } from "@solidjs/web";
import { createMemo, flush, Loading, Reveal } from "solid-js";

const fetchIn = <T,>(value: T, ms: number): Promise<T> =>
  new Promise(resolve => setTimeout(() => resolve(value), ms));

function Recommendations() {
  const recommendations = createMemo(async () => fetchIn("Camp Stove", 80));
  return <span>{recommendations()}</span>;
}

function ProductDetails() {
  const product = createMemo(async () => fetchIn("Trail Pack", 10));
  return (
    <section>
      <h1>{product()}</h1>
      <Loading fallback={<i>loading recommendations…</i>}>
        <Recommendations />
      </Loading>
    </section>
  );
}

function Reviews() {
  const reviews = createMemo(async () => fetchIn("4.8 stars", 40));
  return <aside>{reviews()}</aside>;
}

function App() {
  return (
    <Reveal order="together">
      <Loading fallback={<b>loading product…</b>}>
        <ProductDetails />
      </Loading>
      <Loading fallback={<b>loading reviews…</b>}>
        <Reviews />
      </Loading>
    </Reveal>
  );
}

const host = document.body.appendChild(document.createElement("div"));
const report = document.body.appendChild(document.createElement("pre"));
const results: boolean[] = [];

function check(label: string, expected: string) {
  flush();
  const actual = host.textContent ?? "";
  const ok = actual === expected;
  results.push(ok);
  report.textContent += `${ok ? "PASS" : "FAIL"} ${label}\n`;
  report.textContent += `  expected: ${expected}\n  actual:   ${actual}\n`;
}

render(() => <App />, host);

check("initial — both direct fallbacks", "loading product…loading reviews…");

setTimeout(() => {
  check(
    "~40ms — direct slots revealed; nested fallback remains",
    "Trail Packloading recommendations…4.8 stars"
  );
}, 55);

setTimeout(() => {
  check("~80ms — nested boundary revealed independently", "Trail PackCamp Stove4.8 stars");
  report.textContent += results.every(Boolean)
    ? "\nPASS — client isolates the nested Loading from the ancestor Reveal group"
    : "\nFAIL — observed client timeline differs";
}, 100);
```

Expected client report:

```text
PASS initial — both direct fallbacks
PASS ~40ms — direct slots revealed; nested fallback remains
PASS ~80ms — nested boundary revealed independently

PASS — client isolates the nested Loading from the ancestor Reveal group
```

This is the semantic asymmetry: the same component hierarchy reaches the intermediate client state `Trail Pack / loading recommendations… / 4.8 stars`, while streaming SSR does not expose that state because the nested boundary is added to the ancestor's three-key group.

### Hybrid verification: streamed SSR into a real DOM

To remove the remaining string-inspection concern, we also replayed the stream into a real DOM:

1. Render the same product page through `renderToStream`.
2. Apply every chunk to jsdom as it arrives.
3. Execute Solid's emitted `$df`/`$dfj` activation scripts in arrival order.
4. Record `textContent` after every chunk — the states a user could actually see.

The user-visible assertion is deliberately independent of fragment IDs and generated-script structure:

```text
initial: loading product… / loading reviews…

required intermediate state once the two direct slots are ready:
Trail Pack / loading recommendations… / 4.8 stars

final: Trail Pack / Camp Stove / 4.8 stars
```

On beta.17 the required intermediate state never appears: the DOM remains on both outer fallbacks until recommendations resolve, then jumps directly to the final state. With nested boundary isolation the intermediate state appears as expected. This is the practical app impact—a secondary widget suppresses already-ready primary page content—not merely an unexpected `$dfj` key list.

### Expected behavior

If the client/direct-slot behavior is intended, only direct `<Loading>` children of `<Reveal>` participate in its group. Both runs should report PASS. In the nested run, the stream should have this shape:

```text
--- chunk @ ~41ms ---
<template id="01">…4.8 stars…</template>
<script>…$dfj(["00","01"]);…</script>          ← the two direct slots reveal together

--- chunk @ ~81ms ---
<template id="00003">…Camp Stove…</template>
<script>…$df("00003");…</script>                ← nested boundary reveals independently
```

The nested recommendations fallback remains visible inside the already-revealed product slot until recommendations finish.

### Screenshots or Videos

_No response_

### Platform

- OS: macOS
- Browser: n/a (server render under Node 20)
- Version: 2.0.0-beta.17 (re-verified at `next` @ `a51cac19`)

### Additional context

**Root cause:** on the client, `createLoadingBoundary` severs the reveal scope for everything below it (`packages/solid-signals/src/boundaries.ts:388`):

```ts
const owner = createOwner();
if (_revealUsed) setContext(RevealControllerContext, null, owner);
```

This makes reveal groups contain direct boundary slots only. A nested boundary is covered by its own fallback inside the already-revealed parent slot.

The server implementation, `createLoadingBoundary` in `packages/solid/src/server/hydration.ts:68-217`, reads `RevealGroupContext` from its parent to register *itself* (`const revealGroup = parent && runWithOwner(parent, () => getContext(RevealGroupContext));` at `hydration.ts:91`) but never sets `RevealGroupContext` to `null` on the owner its children render under (`hydration.ts:92`).

That context is populated by `<Reveal>`/`createRevealOrder` (`packages/solid/src/server/flow.ts:330` and `:461`). Once inside a `<Reveal>`, every descendant therefore inherits the same group until a nested `<Reveal>` re-scopes it. A plain nested `<Loading>` finds the ancestor group and enrolls via `revealGroup.register(id)` (`hydration.ts:182`) as if it were a sibling slot.

With `order="together"`, one deeply nested slow boundary can consequently hold back every direct slot in the group.

**Which behavior is intended?** The available evidence favors the client/direct-slot behavior, but this is the central semantic question for maintainers to confirm:

- the client severing shipped in the original feature commit (883eeef1, "feat: add createRevealOrder with reveal-aware loading boundaries"); the server implementation (159d204f) did not port that line;
- the docs define every release condition over **direct** slots and state the goal explicitly: *"an outer `together` doesn't have to wait for every grandchild to resolve; it releases as soon as every direct child is showing something"* (`documentation/solid-2.0/03-control-flow.md`, "Minimally ready") — a nested boundary's pending async is a grandchild concern;
- no existing test pins the enrollment behavior (clearing the context for boundary children breaks nothing in the current suite);
- enrollment also corrupts sync `collapsed` counting: a nested pending boundary consumes the collapsed frontier slot, silently dropping the first direct pending slot's fallback.

The docs' "wrapping children in an extra `<Loading>` does not let them escape an outer hold" can be read consistently with the client behavior: nested content still lives inside the parent slot's hidden template and cannot become visible before that parent slot. Isolation only stops the nested boundary from delaying its *ancestors*. If the sentence was instead intended to enroll every descendant boundary into the ancestor group, then the server behavior is intentional and the client implementation plus the repeated "direct slot" documentation need alignment.

Note that server enrollment is currently load-bearing for activation *ordering*: riding the group's `$dfj` guarantees ancestors activate before nested fragments. Therefore, choosing the client/direct-slot behavior requires the paired runtime change in Part 2.

**Suggested fix direction, if client/direct-slot semantics are confirmed:** mirror the client. When the server boundary creates the scope its children render under, clear `RevealGroupContext` on that owner so only direct descendants of `<Reveal>` register into the group.

### Part 2 — the complete fix also needs dom-expressions: `$df` silently drops a swap whose marker is inside a flushed-but-unactivated `<template>`

**⚠️ The severing fix must NOT ship alone.** Once a nested boundary activates independently, a second latent bug surfaces — this one in the dom-expressions client runtime (`packages/runtime/src/server.js`, `REPLACE_SCRIPT`, `0.50.0-next.17`).

`$df(key)` locates its marker with `document.getElementById("pl-" + key)` and `return 0` when it is not found. A marker that lives inside another fragment's not-yet-swapped `<template>` is part of that template's inert content fragment, so `getElementById` cannot see it — and nothing queues or retries the miss. Today this is masked precisely *because* of the server membership behavior above: the nested key always rides the group's `$dfj` after its ancestors. Sever the membership, and a nested boundary that resolves **before** the group releases loses its content:

```text
~10ms  <template id="A">…<template id="pl-N"></template><i>fallback</i><!--pl-N-->…</template>
~25ms  <template id="N">…</template><script>$df("N")</script>   ← pl-N not in live DOM → return 0, dropped
~60ms  <script>$dfj(["A","B"])</script>                          ← A swaps in WITH stale pl-N + fallback
final DOM: nested fallback stuck forever, template#N inert — the delay became content loss
```

The buffered-`replace` path already protects the *unflushed* window (a nested fragment completing before its parent flushes is inlined into the parent's buffer). The unprotected window is exclusively **flushed-but-unactivated**, i.e. Reveal-held slots.

**Runtime fix:** queue misses, drain after every successful swap — a swap (or fallback materialization) is the only event that brings new markers into the live document:

```js
function $df(e,n,o,t){
  if(!(n=document.getElementById(e)))return 0;                      // template gone = already swapped: no-op, never queued
  if(!(o=document.getElementById("pl-"+e)))                          // marker inside a held template
    return (_$HY.dq=_$HY.dq||[]).indexOf(e)<0&&_$HY.dq.push(e),0;   //   → queue for retry
  for(;o&&8!==o.nodeType&&o.nodeValue!=="pl-"+e;)t=o.nextSibling,o.remove(),o=t;
  _$HY.done?o.remove():o.replaceWith(n.content),n.remove(),_$HY.fe(e);
  $dfd();                                                            // drain: swap may have made queued markers live
  return 1
}
```

`$dfl` (collapsed-fallback clone-in) has the same miss-shape and is equally reachable (a collapsed nested group's `revealFallbacks` firing while its ancestor slot is held) — it gets its own queue (`_$HY.dlq`), and a shared `$dfd()` drains both after every successful `$df`/`$dfl` (`$df` first, so a content swap wins over a pending fallback for the same key). Re-queued misses terminate: each drain processes a snapshot, and a queued key is only retried after another successful swap.

**Fix plan — two PRs, both referencing this issue (we can submit both):**

1. `ryansolid/dom-expressions` — the `REPLACE_SCRIPT` deferred queue above. Safe to land standalone (pure robustness). Regression coverage should include: a nested fragment settling *before* its group releases (loses content on the stock runtime), settling *after* release (control), repeated activations for an already-swapped key (no-op, never queued), and a collapsed fallback (`$dfl`) inside a held slot.
2. `solidjs/solid` — clear `RevealGroupContext` on the scope a boundary's children (and fallback) render under in `packages/solid/src/server/hydration.ts`, so only direct descendants of `<Reveal>` register into the group. Lands with or after 1.

**Cross-repo validation:** replaying solid-generated streams into jsdom (chunks applied and activation scripts executed in arrival order) confirms the pairing. With the stock runtime, the nested-resolves-early stream loses the nested content (fallback stuck after the group activates); with the queued runtime it ends correct. Nested-resolves-late, and plain nested `<Loading>` without `<Reveal>` (protected by the buffered-replace path), end correct under both runtimes.

## Does this exist in Solid 1.x?

**Not applicable — new 2.0 API.** `<Reveal>`/reveal groups have no Solid 1.x counterpart.
