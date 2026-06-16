/**
 * @jsxImportSource @solidjs/web
 */
import { describe, expect, test } from "vitest";
import {
  Activity,
  addTransitionType,
  renderToString,
  startGestureTransition,
  startViewTransition,
  UnstableKeepAlive as KeepAlive,
  ViewTransition
} from "@solidjs/web";

describe("Activity and ViewTransition server rendering", () => {
  test("renders Activity children without DOM-only hiding", () => {
    const html = renderToString(() => (
      <Activity mode="hidden">
        <span>Cached</span>
      </Activity>
    ));

    expect(html).toContain("<span");
    expect(html).toContain("Cached");
    expect(html).not.toContain("display");
  });

  test("renders nested Activity children as normal HTML", () => {
    const html = renderToString(() => (
      <Activity mode="hidden">
        <div>
          <Activity mode="visible">
            <span>Nested</span>
          </Activity>
        </div>
      </Activity>
    ));

    expect(html).toContain("<div");
    expect(html).toContain("<span");
    expect(html).toContain("Nested");
    expect(html).not.toContain("display");
  });

  test("renders ViewTransition children without browser transition markup", () => {
    const html = renderToString(() => (
      <ViewTransition name="hero">
        <span>Hero</span>
      </ViewTransition>
    ));

    expect(html).toContain("<span");
    expect(html).toContain("Hero");
    expect(html).not.toContain("view-transition-name");
  });

  test("renders multiple ViewTransition children without wrappers", () => {
    const html = renderToString(() => (
      <ViewTransition name="group">
        <span>One</span>
        <span>Two</span>
      </ViewTransition>
    ));

    expect(html).toContain("One");
    expect(html).toContain("Two");
    expect(html).not.toContain("group");
  });

  test("transition type and gesture helpers are safe server no-ops", () => {
    addTransitionType("route");
    let ran = false;
    startGestureTransition({}, () => {
      ran = true;
      addTransitionType("gesture");
    });

    const html = renderToString(() => (
      <ViewTransition name="server-helper">
        <span>Helper</span>
      </ViewTransition>
    ));

    expect(ran).toBe(true);
    expect(html).toContain("Helper");
  });

  test("startViewTransition runs its scope on the server", async () => {
    const transition = startViewTransition(() => "server-result", { types: ["route"] });

    await expect(transition.result).resolves.toBe("server-result");
    await expect(transition.updateCallbackDone).resolves.toBeUndefined();
  });

  // Must be aliased to a capitalized name to be used as a JSX component — the
  // lowercase `unstable_` prefix would otherwise compile to a host element (matches
  // React's `unstable_Activity` convention).
  test("UnstableKeepAlive renders the current branch on the server (no gesture machinery)", () => {
    const html = renderToString(() => (
      <KeepAlive key={"a" as "a" | "b"}>
        {page => <span data-page={page}>Branch {page}</span>}
      </KeepAlive>
    ));

    // The branch ran with the current key ("a") and rendered as plain HTML — no
    // gesture/keepalive wrapper element or DOM-hiding machinery. (SSR wraps the
    // dynamic `{page}` in hydration markers, so assert on the attribute + statics.)
    expect(html).toContain('data-page="a"');
    expect(html).toContain("Branch");
    expect(html).toContain("<span");
    expect(html).not.toContain("KeepAlive");
    expect(html).not.toContain("display");
  });
});
