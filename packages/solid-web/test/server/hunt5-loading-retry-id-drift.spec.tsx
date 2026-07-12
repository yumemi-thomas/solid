/**
 * @jsxImportSource @solidjs/web
 *
 * HUNT5 protocol audit: server/client hydration-id asymmetry.
 *
 * When a <Loading> boundary's discovery pass throws NotReadyError *synchronously*
 * (component body does a blocking read) AFTER static elements already consumed
 * hydration-id slots (ssrHydrationKey -> getNextChildId), but WITHOUT creating any
 * child owners, the retry's `disposeOwner(o, false)` takes the leaf fast path in
 * packages/solid/src/server/signals.ts (no _firstChild, no _disposal) which does
 * NOT reset `_childCount`. The successful retry then allocates element ids shifted
 * by however many slots the failed pass consumed. The client always starts the
 * boundary content at child 0, so every element in the fragment is unclaimed.
 */
import { describe, expect, test } from "vitest";
import { renderToStream, Loading } from "@solidjs/web";
import { createMemo } from "solid-js";

function renderComplete(code: () => any, options: any = {}): Promise<string> {
  return new Promise(resolve => {
    renderToStream(code, options).then(resolve);
  });
}

describe("Loading discovery retry id drift", () => {
  test("element ids are stable across a sync NotReady retry (no owners in failed pass)", async () => {
    function App() {
      const user = createMemo(async () => ({ name: "Ada" }));
      function UserCard() {
        // synchronous blocking read at component top level -> NotReadyError
        // escapes props.children evaluation (no owner created before throw)
        const u = user();
        return <span>{u.name}</span>;
      }
      return (
        <Loading fallback={<p>loading</p>}>
          <div>static</div>
          <UserCard />
        </Loading>
      );
    }
    const html = await renderComplete(() => <App />);
    // Client-side the boundary content tree starts allocating at child 0:
    // memo owner "1" -> boundary owner "10" -> content computed "100" -> div "1000".
    // The server must emit the same id for the <div>.
    expect(html).toContain("_hk=1000");
  });

  test("control: an owner created in the failed pass resets the counter (full dispose path)", async () => {
    function App() {
      const user = createMemo(async () => ({ name: "Ada" }));
      function UserCard() {
        // memo owner created BEFORE the blocking read -> boundary owner gains a
        // child -> disposeOwner takes the full path and resets _childCount
        const name = createMemo(() => user().name, { sync: true } as any);
        return <span>{name()}</span>;
      }
      return (
        <Loading fallback={<p>loading</p>}>
          <div>static</div>
          <UserCard />
        </Loading>
      );
    }
    const html = await renderComplete(() => <App />);
    expect(html).toContain("_hk=1000");
  });
});
