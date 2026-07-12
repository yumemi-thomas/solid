/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * BUG (dev-only): rendering a frozen / non-extensible component function
 * crashes the dev build with
 *   `TypeError: Cannot add property Symbol(COMPONENT_DEV), object is not extensible`
 * while the production build renders it fine (dev/prod divergence).
 *
 * Root cause: dev builds unconditionally mutate the user's component
 * function with `Object.assign(Comp, { [$DEVCOMP]: true })`:
 *  - packages/solid/src/client/core.ts:198       (createComponent — every JSX component)
 *  - packages/solid/src/client/component.ts:138  (lazy)
 *  - packages/solid-web/src/index.ts:294         (dynamic / <Dynamic>)
 * None of them guard for non-extensible functions (nor skip when the marker
 * is already present).
 */
import { describe, expect, test } from "vitest";
import { createRoot, flush } from "solid-js";
import { Dynamic } from "@solidjs/web";

describe("frozen component functions (dev build)", () => {
  test("<Dynamic> renders a frozen component without throwing", () => {
    const Comp = Object.freeze((props: any) => <span>{props.x}</span>);
    let el!: HTMLDivElement;
    const dispose = createRoot(d => {
      el = (
        <div>
          <Dynamic component={Comp} x="hi" />
        </div>
      ) as HTMLDivElement;
      return d;
    });
    flush();
    expect(el.textContent).toBe("hi");
    dispose();
  });

  test("direct JSX renders a frozen component without throwing", () => {
    const Frozen = Object.freeze((props: any) => <span>{props.x}</span>);
    let el!: HTMLDivElement;
    const dispose = createRoot(d => {
      el = (
        <div>
          <Frozen x="ok" />
        </div>
      ) as HTMLDivElement;
      return d;
    });
    flush();
    expect(el.textContent).toBe("ok");
    dispose();
  });
});
