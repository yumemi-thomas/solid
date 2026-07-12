# 2.0.0-beta.17: the `hydrate()` disposer deletes SSR DOM despite the public API contract

### Describe the bug

The public `hydrate()` documentation says its disposer tears down reactive scopes while leaving DOM nodes in place. In practice, disposing a hydrated root empties the container.

This prevents applications from detaching Solid behavior while retaining server-rendered/static markup — turning an interactive island back into inert but still-visible content — and directly contradicts the documented lifecycle contract.

### Your Example Website or App

_StackBlitz link to be added — paste the code below into `src/repro.tsx` of the standard SolidJS Vite template (`solid-js@2.0.0-beta.17`, `@solidjs/web@2.0.0-beta.17`, `jsxImportSource: "@solidjs/web"`) and load it as the entry module; it logs `PASS`/`FAIL` with expected vs actual to the browser console. `index.html` only needs an empty mount point: `<div id="app"></div>`._

```tsx
import { hydrate } from "@solidjs/web";

const container = document.getElementById("app")!;
container.innerHTML = "<div _hk=0><button>A</button><button>B</button></div>";
globalThis._$HY = { events: [], completed: new WeakSet(), r: {} };

const dispose = hydrate(
  () => (
    <div>
      <button>A</button>
      <button>B</button>
    </div>
  ),
  container
);

console.log(
  "hydrated content present:",
  container.textContent === "AB"
    ? "PASS"
    : `FAIL — expected "AB", got ${JSON.stringify(container.textContent)}`
);

dispose();

console.log(
  "SSR DOM retained after dispose:",
  container.textContent === "AB"
    ? "PASS"
    : `FAIL — expected "AB", got ${JSON.stringify(container.textContent)}`
);
```

### Steps to Reproduce the Bug or Issue

1. Load the page with the repro module and open the browser console.
2. `hydrate()` claims the server-rendered buttons; the first check confirms the content is present.
3. The repro calls the disposer returned by `hydrate()`.
4. On 2.0.0-beta.17 the browser console logs:

```text
hydrated content present: PASS
SSR DOM retained after dispose: FAIL — expected "AB", got ""
```

The hydrated container is cleared — the server-rendered markup is gone from the page.

### Expected behavior

Disposal tears down owners, effects, refs, cleanups, and delegated-root registrations while leaving the claimed SSR nodes in their current state, as the documentation promises:

```text
hydrated content present: PASS
SSR DOM retained after dispose: PASS
```

### Screenshots or Videos

_No response_

### Platform

- OS: macOS
- Browser: Chrome
- Version: 2.0.0-beta.17 (re-verified at `next` @ `a51cac19`)

### Additional context

Root cause: `hydrate()` delegates to the generic runtime `render()` disposer, which always runs:

```js
disposer();
unregisterDelegatedRoot(element);
element.textContent = "";
```

The public contract is in `packages/solid-web/src/index.ts`:

> Returns a `dispose` function that tears down reactive scopes (DOM nodes are left in place).

Suggested fix direction: give the render core an ownership-only disposal mode for hydration, or wrap the returned root disposer without the container-clearing step.

Related but distinct: the same clear-on-dispose implementation also wipes pre-existing siblings when disposing a `render()` mounted into a non-empty container (filed separately). This one is a distinct API-contract failure: hydrated SSR nodes are the root's claimed *input*, not client-created output.

Verified in the repo's vitest jsdom harness; the inline code above is the same sequence.

## Does this exist in Solid 1.x?

**Long-standing behavior, new contract.** The generic clear-on-dispose behavior is long-standing, but the current 2.0 public documentation explicitly promises that hydrated DOM remains, so on 2.0 it is a documented-contract violation.
