// 1.x check for finding 20: does disposing a root wipe pre-existing container content?
import { describe, expect, test } from "vitest";
import { render } from "solid-js/web";

describe("1.x: dispose of render() into a non-empty container", () => {
  test("pre-existing content survives dispose", () => {
    const container = document.createElement("div");
    container.innerHTML = "<p>keep me</p>";
    document.body.appendChild(container);

    const dispose = render(() => <span>app</span>, container);
    expect(container.querySelector("span")).not.toBeNull();
    expect(container.querySelector("p")).not.toBeNull();

    dispose();
    console.log("[20] container after dispose:", container.innerHTML);
    expect(container.querySelector("span")).toBeNull(); // app removed
    expect(container.querySelector("p")).not.toBeNull(); // pre-existing content kept
    container.remove();
  });
});
