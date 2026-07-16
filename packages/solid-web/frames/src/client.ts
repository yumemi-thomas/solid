// @solidjs/web/frames — client half. Consume frame streams into live DOM
// boundaries (resident store, policy-A morphs, client-owned projections) and
// the Solid sugar for using a server component like any other component.
//
// Source-level entry while frames are pre-release; dist/exports wiring lands
// with the release packaging.
import { createRenderEffect, onCleanup } from "solid-js";
import type { JSX } from "solid-js";
import {
  createFrameHost,
  createFrameInsertable
} from "@dom-expressions/runtime/src/frame-client.js";
import { applyFrameResponse } from "@dom-expressions/runtime/src/frame-transport.js";
import { createJSONDataTable } from "@dom-expressions/runtime/src/serializer.js";

export {
  createFrame,
  createFrameHost,
  createFrameInsertable,
  chunkToRecords
} from "@dom-expressions/runtime/src/frame-client.js";
export {
  FRAME_STREAM_HEADER,
  applyFrameResponse,
  isFrameStreamResponse
} from "@dom-expressions/runtime/src/frame-transport.js";
export { createJSONDataTable } from "@dom-expressions/runtime/src/serializer.js";

// One host per app is the norm: a shared response-scoped data table and one
// chunk router. Apps needing isolation pass their own host.
let sharedHost: any;
export function getFrameHost() {
  if (!sharedHost) {
    const table = createJSONDataTable();
    sharedHost = createFrameHost({
      applyData: (c: any) => table.apply(c),
      resolve: (ref: any) => table.resolve(ref)
    });
  }
  return sharedHost;
}

/** Resolve Solid JSX slot content (thunks, arrays, primitives) to nodes. */
function normalizeSlotContent(value: any): Node | Node[] {
  while (typeof value === "function") value = value();
  if (Array.isArray(value)) {
    const out: Node[] = [];
    for (const v of value) {
      const n = normalizeSlotContent(v);
      Array.isArray(n) ? out.push(...n) : out.push(n);
    }
    return out;
  }
  if (value == null || typeof value === "boolean") return document.createTextNode("");
  return value instanceof Node ? value : document.createTextNode(String(value));
}

/**
 * A server component as a Solid component. `source` is tracked: it fetches
 * the frame-stream Response (typically a server-function call whose result
 * is a component) and re-runs when the signals it reads change — every
 * response streams into the **same** frame id, so navigations morph server
 * content in place while client-owned projections and their state survive
 * (policy A). This is deliberately not `dynamic(() => ...)`: swapping
 * components would remount the boundary and drop that state.
 *
 * Props are the projections: a function prop answers the server's
 * render-prop slots with its args; any other prop (JSX children included)
 * fills its direct-insert position. Server inputs travel as the *call's*
 * arguments inside `source`, never as props.
 *
 * The boundary disposes with the owning scope.
 */
export function createServerComponent(
  source: () => Promise<Response> | Response | null | undefined | false,
  options: { id: string; host?: any }
): (props: Record<string, any>) => JSX.Element {
  const id = options.id;
  return (props: Record<string, any>) => {
    const host = options.host ?? getFrameHost();
    const slots = new Proxy(
      {},
      {
        get(_, prop) {
          if (typeof prop !== "string" || !(prop in props)) return undefined;
          return (slotProps: any) => {
            const v = props[prop];
            return normalizeSlotContent(typeof v === "function" ? v(slotProps) : v);
          };
        }
      }
    );
    const insertable = createFrameInsertable({ host, id, slots });
    onCleanup(() => insertable.dispose());
    createRenderEffect(
      () => source(),
      response => {
        if (response) {
          Promise.resolve(response).then(r => applyFrameResponse(r, host, { as: id }));
        }
      }
    );
    return insertable as unknown as JSX.Element;
  };
}
