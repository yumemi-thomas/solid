/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * BUG: inserting a DocumentFragment into a multi (marker) slot loses track
 * of its children: on the next update the old children are left in the DOM
 * forever alongside the new value.
 *
 * `JSX.Element` includes `Node` (packages/solid-web/src/jsx.d.ts:138), and
 * fragments are the standard way third-party/interop code hands over a batch
 * of nodes. Solid 1.x expanded fragments into their child nodes inside
 * `normalizeIncomingArray`; the 2.0 pipeline (`flatten` in
 * packages/solid-signals/dist/dev.js:4802-4856 + `normalize`/`insertExpression`
 * in packages/solid-web/dist/dev.js:806-822/769-805) has no nodeType-11
 * handling. The fragment object itself is kept as `current`; appending it
 * moves its children out, so when the slot updates, `current.parentNode` is
 * null, ownership checks fail, and the children can never be removed.
 */
import { describe, expect, test } from "vitest";
import { createSignal, createRoot, flush } from "solid-js";

const makeFrag = (a: string, b: string) => {
  const f = document.createDocumentFragment();
  const i1 = document.createElement("i");
  i1.textContent = a;
  const i2 = document.createElement("i");
  i2.textContent = b;
  f.append(i1, i2);
  return f;
};

describe("DocumentFragment in a dynamic slot", () => {
  test("control: initial fragment insert renders its children", () => {
    const [v] = createSignal<any>(makeFrag("1", "2"));
    let el!: HTMLDivElement;
    const dispose = createRoot(d => {
      el = (
        <div>
          <span>before</span>
          {v()}
          <span>after</span>
        </div>
      ) as HTMLDivElement;
      return d;
    });
    flush();
    expect(el.textContent).toBe("before12after"); // passes
    dispose();
  });

  test("replacing the fragment with text removes the fragment's children", () => {
    const [v, setV] = createSignal<any>(makeFrag("1", "2"));
    let el!: HTMLDivElement;
    const dispose = createRoot(d => {
      el = (
        <div>
          <span>before</span>
          {v()}
          <span>after</span>
        </div>
      ) as HTMLDivElement;
      return d;
    });
    flush();
    expect(el.textContent).toBe("before12after");
    setV("x");
    flush();
    // stale <i>1</i><i>2</i> must be gone
    expect(el.textContent).toBe("beforexafter");
    dispose();
  });

  test("replacing the fragment with another fragment must not accumulate children", () => {
    const [v, setV] = createSignal<any>(makeFrag("1", "2"));
    let el!: HTMLDivElement;
    const dispose = createRoot(d => {
      el = (
        <div>
          <span>before</span>
          {v()}
          <span>after</span>
        </div>
      ) as HTMLDivElement;
      return d;
    });
    flush();
    setV(makeFrag("3", "4"));
    flush();
    expect(el.textContent).toBe("before34after");
    dispose();
  });
});
