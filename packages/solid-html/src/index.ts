import { createTaggedJSXRuntime } from "./tagged-jsx.js";
import type { TaggedJSXInstance } from "./tagged-jsx.js";
import {
  insert,
  spread,
  createComponent,
  mergeProps,
  claimElement,
  SVGElements,
  MathMLElements,
  VoidElements,
  RawTextElements
} from "@solidjs/web";

// Annotate explicitly through the local `./tagged-jsx.js` re-export so the
// emitted `.d.ts` references `import("./tagged-jsx.js").TaggedJSXInstance<{}>`
// instead of `import("@dom-expressions/tagged-jsx").TaggedJSXInstance<{}>`.
// The upstream package only ships an ESM `.d.mts`, which TS Node16 CJS
// resolution rejects without a `with { "resolution-mode": "import" }`
// attribute. Routing through the locally copied `./types/tagged-jsx.d.ts`
// (and its `./types-cjs/tagged-jsx.d.cts` twin) avoids the issue entirely.
const html: TaggedJSXInstance<{}> = createTaggedJSXRuntime({
  insert,
  spread,
  createComponent,
  mergeProps,
  claimElement,
  SVGElements,
  MathMLElements,
  VoidElements,
  RawTextElements
});

export default html;
