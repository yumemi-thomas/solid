/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { describe, expect, test } from "vitest";
import { render } from "@solidjs/web";
import { createMemo, createSignal, flush, isPending, latest, Loading } from "solid-js";

/**
 * DOM-level repro of https://github.com/solidjs/solid/issues/2829
 * Mirrors the StackBlitz App.tsx with controllable promises.
 */
describe("issue #2829: latest() + isPending() with two async memos", () => {
  test("initial reveal shows latest(asyncValue); clicks toggle pending correctly", async () => {
    const [count, setCount] = createSignal(0);
    const aRes: Array<() => void> = [];
    const bRes: Array<() => void> = [];

    const asyncValue = createMemo(() => {
      const c = count();
      return new Promise<string>(r => aRes.push(() => r(`Async Value ${c}`)));
    });
    const asyncValue2 = createMemo(() => {
      const c = count();
      return new Promise<string>(r => bRes.push(() => r(`Async Value 2 ${c}`)));
    });

    const container = document.createElement("div");
    document.body.appendChild(container);

    render(
      () => (
        <Loading fallback="Loading...">
          <button onClick={() => setCount(count() + 1)}>Click me</button>
          <p id="count" style={{ opacity: isPending(count) ? 0.5 : 1 }}>
            Count: {count()}
          </p>
          <p id="latest" style={{ opacity: isPending(() => latest(asyncValue)) ? 0.5 : 1 }}>
            Latest Async Value: {latest(asyncValue)}
          </p>
          <p id="second" style={{ opacity: isPending(asyncValue2) ? 0.5 : 1 }}>
            Async Value 2: {asyncValue2()}
          </p>
        </Loading>
      ),
      container
    );

    const settle = async () => {
      await Promise.resolve();
      await Promise.resolve();
      flush();
    };

    flush();
    expect(container.textContent).toBe("Loading...");

    // t=1s: fast memo resolves; boundary still blocked by slow memo
    aRes.shift()!();
    await settle();
    // t=5s: slow memo resolves -> reveal
    bRes.shift()!();
    await settle();

    const latestP = () => container.querySelector<HTMLElement>("#latest")!;
    const secondP = () => container.querySelector<HTMLElement>("#second")!;
    console.log("[reveal] latest p:", latestP().textContent, "| second p:", secondP().textContent);

    // CLAIM 1: latest(asyncValue) should show the resolved value at reveal
    expect(latestP().textContent).toBe("Latest Async Value: Async Value 0");

    // --- first click ---
    container.querySelector("button")!.click();
    flush();
    console.log(
      "[click1] latest opacity:",
      latestP().style.opacity,
      "| text:",
      latestP().textContent
    );
    // CLAIM 2: isPending(() => latest(asyncValue)) should be true right after the click
    expect(latestP().style.opacity).toBe("0.5");

    aRes.shift()!();
    await settle();
    console.log(
      "[click1 A resolved] latest opacity:",
      latestP().style.opacity,
      "| text:",
      latestP().textContent,
      "| second opacity:",
      secondP().style.opacity
    );
    // CLAIM 3: pending should clear when asyncValue itself resolves,
    // even though asyncValue2 is still in flight
    expect(latestP().textContent).toBe("Latest Async Value: Async Value 1");
    expect(latestP().style.opacity).toBe("1");

    bRes.shift()!();
    await settle();
    console.log(
      "[click1 B resolved] latest opacity:",
      latestP().style.opacity,
      "| second:",
      secondP().textContent
    );

    // --- second click ---
    container.querySelector("button")!.click();
    flush();
    console.log("[click2] latest opacity:", latestP().style.opacity);
    expect(latestP().style.opacity).toBe("0.5");

    aRes.shift()!();
    await settle();
    console.log(
      "[click2 A resolved] latest opacity:",
      latestP().style.opacity,
      "| text:",
      latestP().textContent
    );
    expect(latestP().style.opacity).toBe("1");

    bRes.shift()!();
    await settle();
  });
});
