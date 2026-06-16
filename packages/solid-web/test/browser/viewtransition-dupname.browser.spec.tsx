/**
 * @jsxImportSource @solidjs/web
 */
// Guards the dev-only "two <ViewTransition name='…'> mounted at the same time"
// check against false positives. Legitimate same-name *shares* (an exiting and an
// entering boundary briefly carrying the same name) and keyed tab switches must
// NOT trip it — only a genuinely duplicated live mount should. (The warnings seen
// in the example dev server came from HMR/reload re-mounting the whole app, not
// from these patterns.)
//
// These flows (shares, keyed switches, overlapping transitions) also skip/abort
// browser transitions, which reject `ready`/`finished` with AbortError. Vitest
// fails the run on any unhandled rejection, so these tests double as a guard that
// startBrowserViewTransition defuses those promises (no "Transition was skipped"
// console noise).
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createSignal, flush, For, Show } from "solid-js";
import { render, startViewTransition, ViewTransition } from "@solidjs/web";

const raf = () => new Promise<void>(r => requestAnimationFrame(() => r()));
const settle = async () => {
  for (let i = 0; i < 60; i++) {
    const vt = document.documentElement
      .getAnimations({ subtree: true })
      .filter(a => (a.effect as KeyframeEffect)?.pseudoElement?.includes?.("::view-transition"));
    if (!vt.length) break;
    await raf();
  }
};

let container: HTMLDivElement;
let errorSpy: ReturnType<typeof vi.spyOn>;
let errors: string[];

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  errors = [];
  errorSpy = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
    errors.push(a.join(" "));
  });
});

afterEach(() => {
  errorSpy.mockRestore();
  container.remove();
});

const dupWarnings = () => [...new Set(errors.filter(e => /same name/.test(e)))];

test("same-name share (card select) does not warn about duplicate names", async () => {
  const ids = ["x", "y", "z"] as const;
  const [sel, setSel] = createSignal<(typeof ids)[number]>("x");
  const dispose = render(
    () => (
      <div>
        <For each={ids}>
          {id => (
            <Show when={sel() !== id} fallback={<span>{id}</span>}>
              <ViewTransition name={`g-${id}`} share="s">
                <span>{id}</span>
              </ViewTransition>
            </Show>
          )}
        </For>
        <ViewTransition name={`g-${sel()}`} share="s">
          <article>detail {sel()}</article>
        </ViewTransition>
      </div>
    ),
    container
  );
  await raf();

  for (const next of ["y", "z", "x"] as const) {
    startViewTransition(() => {
      setSel(next);
      flush();
    });
    await settle();
    await raf();
  }
  await new Promise(r => setTimeout(r, 30));
  dispose();

  expect(dupWarnings()).toEqual([]);
});

test("keyed panel tab switch does not warn about duplicate names", async () => {
  const [tab, setTab] = createSignal<"a" | "b">("a");
  const dispose = render(
    () => (
      <Show when={tab()} keyed>
        {t => (
          <ViewTransition name={`panel-${t}`}>
            <section>{t}</section>
          </ViewTransition>
        )}
      </Show>
    ),
    container
  );
  await raf();

  for (const next of ["b", "a", "b"] as const) {
    startViewTransition(() => {
      setTab(next);
      flush();
    });
    await settle();
    await raf();
  }
  await new Promise(r => setTimeout(r, 30));
  dispose();

  expect(dupWarnings()).toEqual([]);
});

test("a real error thrown in a transition scope still surfaces (defuse hides only AbortError)", async () => {
  // Defusing ready/finished must not hide application errors: an error thrown by
  // the update scope is delivered on `result` and `updateCallbackDone`.
  const t = startViewTransition(() => {
    throw new Error("scope-boom");
  });
  let resultErr: unknown;
  let ucdErr: unknown;
  await Promise.all([
    t.result.catch(e => (resultErr = e)),
    t.updateCallbackDone.catch(e => (ucdErr = e))
  ]);
  await settle();
  expect((resultErr as Error)?.message).toBe("scope-boom");
  expect((ucdErr as Error)?.message).toBe("scope-boom");
});

test("a genuinely duplicated live mount DOES warn (the check still works)", async () => {
  const dispose = render(
    () => (
      <div>
        <ViewTransition name="real-dup">
          <span>one</span>
        </ViewTransition>
        <ViewTransition name="real-dup">
          <span>two</span>
        </ViewTransition>
      </div>
    ),
    container
  );
  await raf();
  dispose();

  expect(dupWarnings()).toContain(
    'There are two <ViewTransition name="real-dup"> components with the same name mounted at the same time.'
  );
});
