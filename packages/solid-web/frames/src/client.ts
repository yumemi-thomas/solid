// @solidjs/web/frames — client half. Consume frame streams into live DOM
// boundaries (resident store, policy-A morphs, client-owned projections).
//
// There is deliberately no server-component API in this module: calling
// installServerComponents() once in the client entry installs the transport
// policy that makes `dynamic` + server functions the whole client surface.
// A server-function call whose response is a frame
// stream resolves with a stable component — the same reference for every
// refetch from the same call site — so `dynamic(() => getStory(id()))`
// never remounts; the response streams into the boundary underneath and
// server content morphs in place while client-owned projections and their
// state survive (policy A).
//
// Source-level entry while frames are pre-release; dist/exports wiring lands
// with the release packaging.
import { getOwner, onCleanup, sharedConfig } from "solid-js";
import type { JSX } from "solid-js";
import {
  adoptFrameRange,
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

// One host per app is the norm: one chunk router, with codec data tables
// rotated PER RESPONSE — the deserializer's cross-reference space is
// stream-scoped by contract, so each stream into a boundary gets a fresh
// table (routed by root frame id; nested region ids prefix-match to their
// root's table). Apps needing isolation pass their own host.
let sharedHost: any;
const tables = new Map<string, any>();
function tableFor(id: string) {
  const table = tables.get(id);
  if (table) return table;
  for (const [root, t] of tables) if (id.startsWith(root + ".")) return t;
  return undefined;
}
/** Rotate in a fresh response-scoped data table for a boundary's stream. */
function beginStream(frameId: string) {
  tables.set(frameId, createJSONDataTable());
}
export function getFrameHost() {
  if (!sharedHost) {
    sharedHost = createFrameHost({
      applyData: (c: any) => tableFor(c.id)?.apply(c),
      resolve: (ref: any, id: string) => tableFor(id)?.resolve(ref)
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
function slotsFor(props: Record<string, any>) {
  return new Proxy(
    {},
    {
      get(_, prop) {
        if (typeof prop !== "string" || !(prop in props)) return undefined;
        return (slotProps: any, ctx: any) => {
          const v = props[prop];
          const render = () => normalizeSlotContent(typeof v === "function" ? v(slotProps) : v);
          const context = (sharedConfig as any).context;
          if (ctx && ctx.frame && (sharedConfig as any).hydrating && context) {
            // The claim: re-render this occurrence under the SAME hydration
            // key prefix the document producer scoped it with — solid's
            // registry hands the render its server-rendered nodes by key,
            // so the SSR'd wrapper (interior included) becomes the live
            // component's DOM. Templates never ship as data; the claim IS
            // the transfer.
            const prevId = context.id;
            const prevCount = context.count;
            context.id = `sc-${ctx.frame}-${ctx.key}-`;
            context.count = 0;
            try {
              return render();
            } finally {
              context.id = prevId;
              context.count = prevCount;
            }
          }
          return render();
        };
      }
    }
  );
}

function boundaryComponent(host: any, id: string) {
  return (props: Record<string, any>) => {
    const insertable = createFrameInsertable({ host, id, slots: slotsFor(props) });
    onCleanup(() => insertable.dispose());
    return insertable as unknown as JSX.Element;
  };
}

/**
 * The document-adoption implementation behind `self._$SC.r(id)`
 * placeholders (see SERVER_COMPONENT_BOOTSTRAP): find the SSR'd
 * `frame:<id>` comment range in the document, bind an adopting frame over
 * it (slots claim/replace within their server-rendered ranges), and hand
 * hydration back the existing nodes so nothing re-renders. Registered per
 * function id so post-load streams (remapped onto the same id) morph the
 * adopted content.
 */
// Boundaries the page carried that a component has already bound to —
// intercepted calls consume them exactly once, so post-load navigations go
// to the network like any other call.
const claimedBoundaries = new Set<string>();

function findBoundaryRange(id: string): [Comment, Comment] | undefined {
  if (typeof document === "undefined" || !document.body) return undefined;
  const startText = `frame:${id}:start`;
  const endText = `frame:${id}:end`;
  const walker = document.createTreeWalker(document.body, 128 /* COMMENT */);
  let start: Comment | null = null;
  while (walker.nextNode()) {
    const text = (walker.currentNode as Comment).data;
    if (text === startText) start = walker.currentNode as Comment;
    else if (text === endText && start) return [start, walker.currentNode as Comment];
  }
  return undefined;
}

function documentBoundary(host: any, id: string, props: Record<string, any>) {
  const range = !claimedBoundaries.has(id) && findBoundaryRange(id);
  // No SSR'd boundary on the page (client-only boot, or already claimed):
  // mount fresh — the pending/late stream fills it exactly like the
  // non-document path.
  if (!range) return boundaryComponent(host, id)(props);
  claimedBoundaries.add(id);
  const [start, end] = range;
  const frame = adoptFrameRange(start, end, { host, id, slots: slotsFor(props) });
  onCleanup(() => frame.dispose());
  const nodes: Node[] = [];
  for (let n: Node | null = start; n; n = n.nextSibling) {
    nodes.push(n);
    if (n === end) break;
  }
  return nodes as unknown as JSX.Element;
}

/**
 * Installs the server-component transport policy on the server-function
 * client: boundary identity derives from the reactive owner captured at
 * each call site (`getOwner`), so distinct `dynamic()` sources get
 * independent boundaries with nothing declared, refetches from the same
 * source resolve to the identical component, and ownerless calls fall back
 * to one boundary per function id.
 *
 * Call once in the client entry (an explicit call — the package is
 * `sideEffects: false`, so a bare import would be tree-shaken away);
 * call again to rebind to a custom host.
 */
export function installServerComponents(host: any = getFrameHost()) {
  // Upgrade the document shell's placeholder bootstrap (if present): the
  // hydration data scripts resolved server-component references to stable
  // per-id placeholders; installing `impl` makes them mount-adopting.
  const g = globalThis as any;
  if (!g._$SC) {
    g._$SC = {
      c: {},
      r(i: string) {
        return g._$SC.c[i] || (g._$SC.c[i] = (p: any) => g._$SC.impl(i, p));
      }
    };
  }
  g._$SC.impl = (id: string, props: any) => documentBoundary(host, id, props);
  configureServerFunctionsClient({
    responseHandler: createServerComponentHandler({
      host,
      capture: () => getOwner() ?? undefined,
      component: (frameId: string) => boundaryComponent(host, frameId),
      onStream: (frameId: string) => beginStream(frameId),
      documentComponent: (functionId: string) => g._$SC.c[functionId],
      // The page IS the t=0 record: a call whose function has an unclaimed
      // SSR'd boundary in the document resolves locally with the stable
      // placeholder — the source re-runs during hydration per dynamic's
      // contract, but no request leaves the browser. The boundary is
      // consumed on adoption, so navigations fetch normally and (via
      // documentComponent above) resolve to the SAME placeholder.
      intercept: ({ id }: { id: string }) => {
        if (claimedBoundaries.has(id) || !findBoundaryRange(id)) return undefined;
        return g._$SC.r(id);
      }
    })
  });
}
