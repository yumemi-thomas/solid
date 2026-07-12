/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * BUG: for NON-delegated events the array handler form `[fn, data]` is
 * installed by mutating the user's own tuple:
 *   `node.addEventListener(name, (handler[0] = e => handlerFn.call(node, handler[1], e)))`
 * (@dom-expressions/runtime src/client.js:243, bundled at
 * packages/solid-web/dist/dev.js:330-332).
 *
 * Consequences:
 *  1. The user's array is destructively mutated (`tuple[0]` is no longer
 *     the original function).
 *  2. Sharing one tuple across two elements chains the wrappers: the second
 *     element's listener calls the first element's wrapper as if it were the
 *     user function, so the user callback receives `(data, data)` — the
 *     event argument is replaced by the bound data.
 *
 * The delegated path stores handler+data on the node and does not have this
 * problem, so `onClick={tuple}` works while `onMouseEnter={tuple}` breaks.
 */
import { describe, expect, test } from "vitest";
import { render } from "@solidjs/web";

describe("non-delegated bound handler [fn, data]", () => {
  test("one tuple shared by two elements: both handlers receive (data, event)", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const calls: any[] = [];
    const fn = (data: any, e: any) => calls.push([data, e instanceof Event ? "event" : typeof e]);
    // module-level constant tuple, used on several elements (mouseenter is
    // not a delegated event, so this exercises addEventListener + wrapper)
    const tuple = [fn, "payload"] as any;
    let a!: HTMLDivElement, b!: HTMLDivElement;
    const dispose = render(
      () => (
        <>
          <div ref={(e: HTMLDivElement) => (a = e)} onMouseEnter={tuple} />
          <div ref={(e: HTMLDivElement) => (b = e)} onMouseEnter={tuple} />
        </>
      ),
      container
    );

    a.dispatchEvent(new Event("mouseenter"));
    b.dispatchEvent(new Event("mouseenter"));
    expect(calls).toEqual([
      ["payload", "event"],
      ["payload", "event"]
    ]);

    dispose();
    container.remove();
  });

  test("the user's tuple must not be mutated", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const fn = () => {};
    const tuple = [fn, 42] as any;
    const dispose = render(() => <div onMouseEnter={tuple} />, container);
    expect(tuple[0]).toBe(fn);
    dispose();
    container.remove();
  });

  test("control: delegated events tolerate a shared tuple", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const calls: any[] = [];
    const fn = (data: any, e: any) => calls.push([data, e instanceof Event ? "event" : typeof e]);
    const tuple = [fn, "payload"] as any;
    let a!: HTMLDivElement, b!: HTMLDivElement;
    const dispose = render(
      () => (
        <>
          <div ref={(e: HTMLDivElement) => (a = e)} onClick={tuple} />
          <div ref={(e: HTMLDivElement) => (b = e)} onClick={tuple} />
        </>
      ),
      container
    );
    a.click();
    b.click();
    expect(calls).toEqual([
      ["payload", "event"],
      ["payload", "event"]
    ]);
    expect(tuple[0]).toBe(fn);
    dispose();
    container.remove();
  });
});
