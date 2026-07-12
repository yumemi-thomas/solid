/**
 * @jsxImportSource @solidjs/web
 *
 * HUNT5 protocol audit: server createStore/createOptimisticStore (derived form)
 * silently drop the third ProjectionOptions argument (ssrSource, deferStream).
 * packages/solid/src/server/signals.ts createStore(first, second) has no options
 * param and calls createProjection(first, second) without forwarding.
 *
 * With ssrSource: "client" the server should render the seed (initialValue) and
 * skip serialization, matching the client which ignores the server value and
 * computes after hydration. Instead the server runs the compute and renders its
 * result -> hydration adopts server DOM that the client state doesn't match.
 */
import { describe, expect, test } from "vitest";
import { renderToString } from "@solidjs/web";
import { createStore, createProjection } from "solid-js";

describe("server derived-store options forwarding", () => {
  test("createStore(fn, seed, { ssrSource: 'client' }) renders the seed", () => {
    function App() {
      const [state] = createStore(s => void (s.n = 1), { n: 0 }, {
        ssrSource: "client"
      } as any);
      return <div>{state.n}</div>;
    }
    const html = renderToString(() => <App />);
    expect(html).toContain(">0<");
  });

  test("control: createProjection(fn, seed, { ssrSource: 'client' }) renders the seed", () => {
    function App() {
      const state = createProjection(s => void ((s as any).n = 1), { n: 0 }, {
        ssrSource: "client"
      } as any);
      return <div>{(state as any).n}</div>;
    }
    const html = renderToString(() => <App />);
    expect(html).toContain(">0<");
  });
});
