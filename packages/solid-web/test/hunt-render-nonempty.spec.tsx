/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { describe, expect, test } from "vitest";
import { render } from "@solidjs/web";

describe("render() into a non-empty container", () => {
  test("appends and dispose removes only what it rendered", () => {
    const container = document.createElement("div");
    container.innerHTML = "<p>static content</p>";
    const dispose = render(() => <span>app</span>, container);
    // 2.0 supports rendering into non-empty containers (appends after existing content)
    expect(container.querySelector("p")).toBeTruthy();
    expect(container.querySelector("span")?.textContent).toBe("app");
    dispose();
    // disposing the root must not destroy unrelated pre-existing DOM
    expect(container.querySelector("span")).toBeNull();
    expect(container.querySelector("p")).toBeTruthy();
  });
});
