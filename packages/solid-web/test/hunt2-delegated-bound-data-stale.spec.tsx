/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * BUG: swapping a delegated bound handler `[fn, data]` for a plain handler
 * leaves the old `$$<event>Data` on the node forever. The new plain handler
 * is then invoked as `handler(staleData, event)` instead of `handler(event)`.
 *
 * Root cause: `addEvent` (@dom-expressions/runtime src/client.js:236-241,
 * bundled at packages/solid-web/dist/dev.js:324-329) sets
 * `node[`$$${name}Data`]` for the array form but never clears it when a
 * later update installs a non-array handler. `eventHandler`
 * (src/client.js:718-721, dist/dev.js:726-731) dispatches on
 * `data !== undefined`, so any handler installed after an array handler on
 * the same element receives the ancient data as its first argument.
 */
import { describe, expect, test } from "vitest";
import { createSignal, flush } from "solid-js";
import { render } from "@solidjs/web";

describe("delegated bound handler data lifetime", () => {
  test("swapping [fn, data] for a plain handler must not pass stale data", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const calls: any[] = [];
    const bound = (data: any, e: Event) => calls.push(["bound", data, e.type]);
    const plain = (...args: any[]) =>
      calls.push(["plain", args.length, args[0] instanceof Event ? "event" : typeof args[0]]);
    const [p, setP] = createSignal<any>({ onClick: [bound, { id: 1 }] });
    let el!: HTMLDivElement;
    const dispose = render(() => <div ref={(e: HTMLDivElement) => (el = e)} {...p()} />, container);

    el.click();
    expect(calls).toEqual([["bound", { id: 1 }, "click"]]); // control: bound form works
    calls.length = 0;

    setP({ onClick: plain });
    flush();
    el.click();
    // the plain handler must receive exactly (event)
    expect(calls).toEqual([["plain", 1, "event"]]);

    dispose();
    container.remove();
  });

  test("handler removed then re-added later must not resurrect ancient data", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const calls: any[] = [];
    const bound = (data: any) => calls.push(["bound", data]);
    const fresh = (...args: any[]) =>
      calls.push(["fresh", args[0] instanceof Event ? "event" : typeof args[0]]);
    const [p, setP] = createSignal<any>({ onClick: [bound, "secret"] });
    let el!: HTMLDivElement;
    const dispose = render(() => <div ref={(e: HTMLDivElement) => (el = e)} {...p()} />, container);

    el.click();
    calls.length = 0;

    setP({}); // remove the handler entirely
    flush();
    el.click();
    expect(calls).toEqual([]); // control: removal works

    setP({ onClick: fresh }); // much later, a completely unrelated handler
    flush();
    el.click();
    expect(calls).toEqual([["fresh", "event"]]);

    dispose();
    container.remove();
  });
});
