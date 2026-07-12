// 1.x check for finding 11: delegated events across nested render roots
import { describe, expect, test } from "vitest";
import { render } from "solid-js/web";

describe("1.x: delegated events across nested render roots", () => {
  test("outer root's delegated handler fires for clicks bubbling out of a nested root", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    let outerClicks = 0;
    let nativeClicks = 0;
    let host!: HTMLDivElement;

    const d1 = render(
      () => (
        <div onClick={() => outerClicks++}>
          <section ref={(el: HTMLElement) => (host = el.firstChild as HTMLDivElement)}>
            <div />
          </section>
        </div>
      ),
      container
    );
    (container.firstChild as HTMLElement).addEventListener("click", () => nativeClicks++);

    let btn!: HTMLButtonElement;
    let innerClicks = 0;
    const d2 = render(
      () => (
        <button ref={(el: HTMLButtonElement) => (btn = el)} onClick={() => innerClicks++}>
          inner
        </button>
      ),
      host
    );

    btn.click();
    console.log("[11] inner:", innerClicks, "native:", nativeClicks, "outer:", outerClicks);
    expect(innerClicks).toBe(1);
    expect(nativeClicks).toBe(1);
    expect(outerClicks).toBe(1);

    d2();
    d1();
    container.remove();
  });
});
