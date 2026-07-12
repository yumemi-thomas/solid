// 1.x check for finding 19: adjacent expression slots swapping the same hoisted DOM nodes
// NOTE: signal writes must happen OUTSIDE the createRoot body — 1.x batches updates
// inside the root callback, which made an earlier version of this check a false no-op.
import { describe, expect, test } from "vitest";
import { createRoot, createSignal, Show } from "solid-js";

test("control: Show flips normally (writes outside root body)", () => {
  const [on, setOn] = createSignal(false);
  let root!: HTMLDivElement;
  const dispose = createRoot(d => {
    root = (
      <div>
        <Show when={on()} fallback={<i>off</i>}>
          <em>on</em>
        </Show>
      </div>
    ) as unknown as HTMLDivElement;
    return d;
  });
  expect(root.innerHTML).toBe("<i>off</i>");
  setOn(true);
  expect(root.innerHTML).toBe("<em>on</em>");
  dispose();
});

describe("1.x: moving the same DOM nodes between sibling expression slots", () => {
  test("two adjacent <Show>s swapping two hoisted elements", () => {
    const el1 = (<span>1</span>) as unknown as HTMLElement;
    const el2 = (<b>2</b>) as unknown as HTMLElement;
    const [swap, setSwap] = createSignal(false);
    let root!: HTMLDivElement;
    const dispose = createRoot(d => {
      root = (
        <div>
          <Show when={swap()} fallback={el1}>
            {el2}
          </Show>
          <Show when={swap()} fallback={el2}>
            {el1}
          </Show>
        </div>
      ) as unknown as HTMLDivElement;
      return d;
    });
    console.log("[19 tail] initial:", JSON.stringify(root.innerHTML));
    expect(root.textContent).toBe("12");
    setSwap(true);
    console.log("[19 tail] after swap:", JSON.stringify(root.innerHTML));
    expect(root.textContent).toBe("21");
    setSwap(false);
    console.log("[19 tail] after flip back:", JSON.stringify(root.innerHTML));
    expect(root.textContent).toBe("12");
    dispose();
  });

  test("with trailing static sibling", () => {
    const el1 = (<span>1</span>) as unknown as HTMLElement;
    const el2 = (<b>2</b>) as unknown as HTMLElement;
    const [swap, setSwap] = createSignal(false);
    let root!: HTMLDivElement;
    const dispose = createRoot(d => {
      root = (
        <div>
          <Show when={swap()} fallback={el1}>
            {el2}
          </Show>
          <Show when={swap()} fallback={el2}>
            {el1}
          </Show>
          <u>end</u>
        </div>
      ) as unknown as HTMLDivElement;
      return d;
    });
    console.log("[19 follower] initial:", JSON.stringify(root.innerHTML));
    expect(root.textContent).toBe("12end");
    setSwap(true);
    console.log("[19 follower] after swap:", JSON.stringify(root.innerHTML));
    expect(root.textContent).toBe("21end");
    setSwap(false);
    console.log("[19 follower] after flip back:", JSON.stringify(root.innerHTML));
    expect(root.textContent).toBe("12end");
    dispose();
  });
});
