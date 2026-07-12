# 2.0.0-beta.17: streaming SSR — an `<Errored>`-wrapped `<Loading>` joins the ancestor `<Reveal>` group on the server, but not on the client

### Describe the bug

Put an `<Errored>` between a `<Reveal>` and one of its `<Loading>` slots:

```tsx
<Reveal order="together">
  <Loading fallback={<b>loading order…</b>}>
    <OrderSummary />       {/* resolves at ~300ms */}
  </Loading>
  <Errored fallback={<i>payment panel unavailable</i>}>
    <Loading fallback={<b>loading payment options…</b>}>
      <PaymentOptions />   {/* flaky third-party, resolves at ~2000ms */}
    </Loading>
  </Errored>
</Reveal>
```

The client and the server disagree about whether the wrapped `<Loading>` is part of the reveal group:

- **Client: it is not.** Every boundary — `Loading` *and* `Errored` — clears the reveal context for its children (`createCollectionBoundary` in `packages/solid-signals/src/boundaries.ts`). The group contains only the order-summary slot: it reveals at ~300ms, the panel independently at ~2000ms.
- **Server: it is.** `createErrorBoundary` (`packages/solid/src/server/signals.ts`) does not clear `RevealGroupContext`, so the wrapped `<Loading>` registers into the group. The stream emits a two-key `$dfj` only at ~2000ms — the order summary is held on its skeleton the whole time.

Same tree, different reveal timing depending on how the user arrives: hard refresh holds everything to ~2s, client-side navigation shows the summary at ~300ms.

Sibling of #2871: the same client/server severing asymmetry, but through `<Errored>` instead of `<Loading>`. Fixing #2871 (`createLoadingBoundary`) does not cover this case.

### Your Example Website or App

**TanStack Start × Solid 2.0 StackBlitz:** <https://stackblitz.com/edit/1snzezwb?file=src%2Froutes%2Findex.tsx>

The checkout page above in a real `@tanstack/solid-start@2.0.0-beta.24` app (`solid-js@2.0.0-beta.17`). `npm start` runs automatically: it streams a control route and the repro route, prints a PASS/FAIL verdict in the **terminal**, and leaves the dev server running so both behaviors are visible in the preview.

### Steps to Reproduce the Bug or Issue

1. Open the StackBlitz and wait for the terminal verdict:

```text
CONTROL /control (no Errored)
  groups: [["…10","…11"]] — two direct slots coordinating is correct
  PASS

REPRO / (Errored-wrapped panel)
  groups: [["…10","…1100"]]; activation at ~2112ms; panel content at ~2112ms
    — wrapped panel was enrolled into the group
  FAIL
```

2. `/control` (no `Errored`) coordinates its two direct slots at ~2s — correct.
3. `/` enrolls the `Errored`-wrapped panel as a group member and holds activation to ~2s. Client semantics require a one-key group at ~300ms with the panel activating independently.
4. In the preview: SPA-navigate `/control` → `/` — the order summary reveals at ~300ms, the panel trails independently. Hard-refresh `/` — everything is held on skeletons to ~2s.

### Expected behavior

The server matches the client: a `<Loading>` separated from `<Reveal>` by an `<Errored>` does not register into the reveal group. The order summary reveals at ~300ms and the panel independently at ~2000ms in both rendering modes.

### Screenshots or Videos

_No response_

### Platform

- OS: macOS
- Browser: Chrome (StackBlitz preview); server render under Node 20
- Version: 2.0.0-beta.17 (`next` @ `a51cac19`)

### Additional context

**The client behavior is deliberate, not incidental.** Two client tests pin it, both specifically about error handling in reveal order:

- `createRevealOrder › advances reveal order when first slot errors inside error boundary`
- `createRevealOrder › nested composite recovers from error without breaking outer progression`

They encode this design: an error-boundary-wrapped slot is intentionally **outside** the group, so that if it errors, its error fallback can appear without stalling the group's progression. (Verified: restricting the client severing to loading boundaries only breaks exactly these two tests and nothing else.) It is the client's structural answer to the "erroring member stalls the group" problem — the same problem that was patched separately on the server for direct slots in #2776.

**Suggested fix:** port the severing to the server — clear `RevealGroupContext` on the scope that `createErrorBoundary`'s children render under, the same pattern as the #2871 fix direction for loading boundaries. Two practical notes:

1. **Module layout:** `RevealGroupContext` is defined in `server/hydration.ts`, which imports *from* `server/signals.ts` where `createErrorBoundary` lives. The context (or a severing helper) has to move to a shared module first.
2. **Sequencing:** this should land **after** the #2871 runtime fix — once the wrapped boundary activates independently, one that settles while the group is still held needs the deferred `$df` activation queue or its content is silently dropped.

Since the resulting rule — *wrapping a slot in `<Errored>` opts it out of reveal coordination* — is intended but currently undocumented, a sentence in the `<Reveal>` docs would prevent surprises.

## Does this exist in Solid 1.x?

**Not applicable — new 2.0 API.** `<Reveal>`/reveal groups have no Solid 1.x counterpart.
