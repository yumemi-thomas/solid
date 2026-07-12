// 1.x check: delegated bound-handler [fn,data] leaking data to a later plain handler
import { describe, expect, test } from "vitest";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";

describe("1.x: delegated bound handler data does not leak to a later handler", () => {
  test("swapping [fn, data] for a plain handler passes the raw event", () => {
    const calls: any[] = [];
    const fn1 = (data: any, e: any) => calls.push(["bound", data, e?.type]);
    const fn2 = (e: any) => calls.push(["plain", e?.type, e?.constructor?.name]);
    const [plain, setPlain] = createSignal(false);
    let btn!: HTMLButtonElement;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(
      () => (
        <button
          ref={(el: HTMLButtonElement) => (btn = el)}
          onClick={(plain() ? fn2 : [fn1, { id: 1 }]) as any}
        >
          x
        </button>
      ),
      container
    );
    btn.click();
    setPlain(true);
    btn.click();
    console.log("[w2-dom-bound] calls:", JSON.stringify(calls));
    // second call: plain handler must get an Event, not the stale {id:1}
    const last = calls[calls.length - 1];
    expect(last[0]).toBe("plain");
    expect(last[1]).toBe("click"); // e.type
    dispose();
    container.remove();
  });
});
