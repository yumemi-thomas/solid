/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { describe, expect, test, vi } from "vitest";
import { createSignal, flush } from "solid-js";
import { render } from "@solidjs/web";
import type { JSX } from "../src/index.js";

// Custom event names are not part of the built-in JSX event map; consumers
// type them via module augmentation of EventHandlersElement.
declare module "../src/index.js" {
  namespace JSX {
    interface EventHandlersElement<T> {
      onCustom?: JSX.EventHandlerUnion<T, CustomEvent> | undefined;
    }
  }
}

describe("Delegated events", () => {
  test("onClick fires with correct target and currentTarget for a bubbling click on a child", () => {
    const container = document.createElement("div");
    let target: EventTarget | null = null;
    let currentTarget: EventTarget | null = null;
    let section!: HTMLElement;
    let button!: HTMLButtonElement;

    document.body.appendChild(container);
    const dispose = render(
      () => (
        <section
          ref={section}
          onClick={e => {
            target = e.target;
            currentTarget = e.currentTarget;
          }}
        >
          <button ref={button}>hit</button>
        </section>
      ),
      container
    );

    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(target).toBe(button);
    expect(currentTarget).toBe(section);
    dispose();
    container.remove();
  });

  // Statically written JSX event handlers are bound once by design (the
  // compiler does not wrap event expressions in effects), so reactive handler
  // swaps go through prop spreads, which rebind via assignProp.
  test("swapping the handler reactively via spread calls the new handler, not the old", () => {
    const container = document.createElement("div");
    const first = vi.fn();
    const second = vi.fn();
    const [useFirst, setUseFirst] = createSignal(true);
    const handlerProps = (): JSX.HTMLAttributes<HTMLButtonElement> => ({
      onClick: useFirst() ? first : second
    });
    let button!: HTMLButtonElement;

    document.body.appendChild(container);
    const dispose = render(() => <button ref={button} {...handlerProps()} />, container);

    button.click();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();

    setUseFirst(false);
    flush();
    button.click();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    dispose();
    container.remove();
  });

  test("setting the handler to undefined via spread removes the response", () => {
    const container = document.createElement("div");
    const handler = vi.fn();
    const [active, setActive] = createSignal(true);
    const handlerProps = (): JSX.HTMLAttributes<HTMLButtonElement> => ({
      onClick: active() ? handler : undefined
    });
    let button!: HTMLButtonElement;

    document.body.appendChild(container);
    const dispose = render(() => <button ref={button} {...handlerProps()} />, container);

    button.click();
    expect(handler).toHaveBeenCalledTimes(1);

    setActive(false);
    flush();
    button.click();
    expect(handler).toHaveBeenCalledTimes(1);
    dispose();
    container.remove();
  });

  test("bound-array form [handler, data] receives data as the first argument", () => {
    const container = document.createElement("div");
    const handler = vi.fn();
    let button!: HTMLButtonElement;

    document.body.appendChild(container);
    const dispose = render(() => <button ref={button} onClick={[handler, 42]} />, container);

    button.click();

    expect(handler).toHaveBeenCalledTimes(1);
    const [data, event] = handler.mock.calls[0];
    expect(data).toBe(42);
    expect(event).toBeInstanceOf(MouseEvent);
    expect(event.type).toBe("click");
    dispose();
    container.remove();
  });
});

// The 1.x `on:custom` namespace form was removed in 2.0: custom events use the
// camelCase form (`onCustom`), which falls back to a native, non-delegated
// `addEventListener("custom", ...)` because "custom" is not in DelegatedEvents.
describe("Native (non-delegated) custom events", () => {
  test("onCustom handler fires for a dispatched CustomEvent", () => {
    const container = document.createElement("div");
    const handler = vi.fn();
    let el!: HTMLDivElement;

    document.body.appendChild(container);
    const dispose = render(() => <div ref={el} onCustom={handler} />, container);

    el.dispatchEvent(new CustomEvent("custom", { detail: "payload" }));

    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0][0] as CustomEvent;
    expect(event.type).toBe("custom");
    expect(event.detail).toBe("payload");
    dispose();
    container.remove();
  });

  test("onCustom listener attaches natively to the element (no delegation)", () => {
    const container = document.createElement("div");
    const handler = vi.fn();
    let el!: HTMLDivElement;

    // Not appended to the document: a native listener still fires while a
    // delegated one would not.
    const dispose = render(() => <div ref={el} onCustom={handler} />, container);

    el.dispatchEvent(new CustomEvent("custom"));

    expect(handler).toHaveBeenCalledTimes(1);
    dispose();
  });

  test("bound-array form works for native events and receives data first", () => {
    const container = document.createElement("div");
    const handler = vi.fn();
    let el!: HTMLDivElement;

    document.body.appendChild(container);
    const dispose = render(() => <div ref={el} onCustom={[handler, "ctx"]} />, container);

    el.dispatchEvent(new CustomEvent("custom"));

    expect(handler).toHaveBeenCalledTimes(1);
    const [data, event] = handler.mock.calls[0];
    expect(data).toBe("ctx");
    expect((event as Event).type).toBe("custom");
    dispose();
    container.remove();
  });
});
