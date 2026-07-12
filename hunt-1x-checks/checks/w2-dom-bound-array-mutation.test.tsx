// 1.x check: non-delegated [fn,data] tuple mutation + shared-tuple wrapper chaining
import { describe, expect, test } from "vitest";
import { render } from "solid-js/web";

describe("1.x: non-delegated bound handler tuple", () => {
  test("shared tuple: both elements get (data, event); user array not mutated", () => {
    const seen: any[] = [];
    const fn = (data: any, e: any) => seen.push([data, e?.type]);
    const tuple: any = [fn, "payload"];
    const container = document.createElement("div");
    document.body.appendChild(container);
    let a!: HTMLDivElement, b!: HTMLDivElement;
    // mouseenter is NOT delegated -> addEventListener path
    const dispose = render(
      () => (
        <div>
          <div ref={(el: HTMLDivElement) => (a = el)} onMouseEnter={tuple} />
          <div ref={(el: HTMLDivElement) => (b = el)} onMouseEnter={tuple} />
        </div>
      ),
      container
    );
    a.dispatchEvent(new Event("mouseenter"));
    b.dispatchEvent(new Event("mouseenter"));
    console.log(
      "[w2-dom-mut] seen:",
      JSON.stringify(seen.map(s => [s[0], s[1]])),
      "tuple[0]===fn:",
      tuple[0] === fn
    );
    expect(seen.every(s => s[0] === "payload" && s[1] === "mouseenter")).toBe(true);
    expect(tuple[0]).toBe(fn); // user tuple not mutated
    dispose();
    container.remove();
  });
});
