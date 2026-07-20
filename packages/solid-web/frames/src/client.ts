// @solidjs/web/frames — client half. Consume frame streams into live DOM
// boundaries (resident store, policy-A morphs, client-owned projections).
//
// There is deliberately no server-component API in this module: importing it
// installs the transport policy that makes `dynamic` + server functions the
// whole client surface. A server-function call whose response is a frame
// stream resolves with a stable component — the same reference for every
// refetch from the same call site — so `dynamic(() => getStory(id()))`
// never remounts; the response streams into the boundary underneath and
// server content morphs in place while client-owned projections and their
// state survive (policy A).
//
// Source-level entry while frames are pre-release; dist/exports wiring lands
// with the release packaging.
import { getOwner, onCleanup } from "solid-js";
import type { JSX } from "solid-js";
import {
  createFrameHost,
  createFrameInsertable
} from "@dom-expressions/runtime/src/frame-client.js";
import { createServerComponentHandler } from "@dom-expressions/runtime/src/frame-transport.js";
import { configureServerFunctionsClient } from "@dom-expressions/runtime/src/server-functions/client.js";
import { createJSONDataTable } from "@dom-expressions/runtime/src/serializer.js";

export {
  createFrame,
  createFrameHost,
  createFrameInsertable,
  chunkToRecords,
  FRAME_APPLIED_EVENT
} from "@dom-expressions/runtime/src/frame-client.js";
export {
  FRAME_STREAM_HEADER,
  applyFrameResponse,
  isFrameStreamResponse,
  createServerComponentHandler
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
 * The stable component minted once per boundary. Every mount creates its own
 * frame instance under the boundary id (mounting the same server component
 * twice fans the stream out to both), props are the projections — a function
 * prop answers the server's render-prop slots with its args; any other prop
 * (JSX children included) fills its direct-insert position — and each
 * instance disposes with its owning scope.
 */
function boundaryComponent(host: any, id: string) {
  return (props: Record<string, any>) => {
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
    return insertable as unknown as JSX.Element;
  };
}

/**
 * Installs the server-component transport policy on the server-function
 * client: boundary identity derives from the reactive owner captured at
 * each call site (`getOwner`), so distinct `dynamic()` sources get
 * independent boundaries with nothing declared, refetches from the same
 * source resolve to the identical component, and ownerless calls fall back
 * to one boundary per function id.
 *
 * Importing `@solidjs/web/frames` runs this once against the shared host;
 * call it again to rebind to a custom host.
 */
export function installServerComponents(host: any = getFrameHost()) {
  configureServerFunctionsClient({
    responseHandler: createServerComponentHandler({
      host,
      capture: () => getOwner() ?? undefined,
      component: (frameId: string) => boundaryComponent(host, frameId)
    })
  });
}

installServerComponents();
