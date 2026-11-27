// @ts-nocheck
/**
 * Frame stream HTTP transport, client half: recognize a frame-tagged
 * server-function Response and pump its framed chunks into a frame host.
 *
 * The wire convention is shared with the server-function transport — each
 * chunk is length-prefixed (`;0x` + 32-bit hex byte length + `;`) UTF-8 of
 * `JSON.stringify(FrameMessage)` (frame-sink.ts) — so both transports read and write through
 * the one framing implementation in server-functions/shared.js. The server
 * half (`serverComponentResponse` / `frameTransformResult`) lives in
 * frame-sink.js; this module stays importable from client bundles.
 */
import {
  LIVE_WIRE,
  frameAddress
} from "../../server-functions/src/shared.js";
import { FrameHost, prepareMorph, prepareTier, tierLoaders, tierLoads } from "./frame-client.js";
import { JSONCodecOptions } from "../../serialization/src/serializer-decode.js";

/**
 * Options for `applyFrameResponse`.
 * @experimental
 */
export interface ApplyFrameResponseOptions {
  /**
   * Remap the producer's root frame id onto a local one — the id your
   * insertable/frame registered under — so navigations to the same boundary
   * reuse the same frame regardless of what the server called it. Boundary
   * identity belongs to the client.
   */
  as?: string;
  /**
   * Restamp every chunk of the response with this version (one response IS
   * one version). Versions belong to the client too: the producer cannot
   * know how many streams a boundary has consumed, so pass the Nth-response
   * counter to make policy A's stale-guard real across navigations. A
   * single-flight response addresses several boundaries, each with its own
   * history — pass a function and it is called once per frame in the
   * response.
   */
  version?: number | ((frameId: string) => number);
  /**
   * Receives the payload text of each `outcome` chunk — the response-scoped
   * single-flight envelope, the caller's result rather than anything the
   * host renders.
   */
  onOutcome?(payload: string): void;
}

/**
 * The value under `COMPONENT_BINDING` on a transport-resolved binding.
 * @experimental
 */
export interface ComponentBinding<C = unknown> {
  /** The per-function mount component (the equals-gate identity). */
  component: C;
  /** The call's intrinsic (function, arguments) address — its store's key. */
  address: string;
}

/**
 * Options for `createServerComponentHandler`.
 * @experimental
 */
export interface ServerComponentHandlerOptions<C = unknown> {
  host: FrameHost;
  /**
   * Builds the framework's mount component for a server FUNCTION. Invoked
   * once per function and cached — this is the equals-gate identity every
   * call of the function resolves through. The component is CALLED (by the
   * binding wrapper or a gated reader), receiving its current address as a
   * second argument (`() => string`); it should (re-)bind its frame's pull
   * to that address's store. Multi-mount fans out per site.
   */
  component(fnId: string): C;
  /**
   * Answer a call before any request is made (t = 0 local answers — a
   * boundary the document already carries). Returning `undefined` is a
   * miss; any other value is a hit, SYNCHRONOUS, resolving the call with
   * its binding — a hydrating consumer never observes a pending beat. A
   * PROMISE is a deferred hit (a boundary the document is still
   * delivering): the call resolves with its binding when it settles truthy,
   * and is a miss after all — the caller fetches — when it settles falsy.
   */
  intercept?(info: { id: string; meta: unknown; args: unknown[] }): unknown | PromiseLike<unknown>;
}

/**
 * Header tagging a Response as a frame stream; its value is the producing
 * frame's id. Frame-owned contract (hence the namespace) — deliberately not
 * a `BodyFormat` entry, since the body is frame chunks, not a serialized
 * value.
 */
export const FRAME_STREAM_HEADER = "X-Frame-Stream";

/**
 * The tiers a frame stream needs (frames savings pass §2, the
 * server-announced tier mechanism): the names, comma-separated, of the
 * frames-client tiers the render had minted when the response head left
 * — `bind,regions,assets,trace,wire` — so the client starts their loads
 * before it reads the body. Omitted when nothing was minted. A tier first
 * needed after the head rides in-band instead: `tiers` on the next chunk
 * (`FrameMessage.tiers`). Additive wire: an old client ignores both; a new
 * client without them falls back to detection at the readiness check and
 * holds (frames-rulings 3.1) — the same DOM, later.
 * @experimental
 */
export const FRAME_TIERS_HEADER = "X-Frame-Tiers";

/**
 * The resume request's have-list (RFC 11 §9.5, Resume request): the
 * digests the client holds for the address it is reconnecting — the root
 * skeleton under `""`, then one entry per live hole (`lh:N`), attr hole
 * (`lha:N`) and revealed fragment (`pl-N`). Its PRESENCE makes the render a
 * conditional one: the server emits a hole or fragment only when it has
 * settled and its digest differs, and never a root or a fallback over
 * content the list names. Rides only to the live address (a `no-store`
 * response nothing keys on) — never as an argument. Decision (f): this
 * name; a list whose encoding would exceed `FRAME_HAVE_BUDGET` bytes is
 * omitted and the client accepts a full snapshot.
 * @experimental
 */
export const FRAME_HAVE_HEADER = "X-Frame-Have";

/** The have-list's size ceiling in encoded bytes (see FRAME_HAVE_HEADER). */
export const FRAME_HAVE_BUDGET = 4096;

// The encoder (`encodeHaveList`) is the live wire tier's (wire-tier.ts): the
// client sends the have-list only from a `live` reconnect, which runs
// through the tier. The decoder below is the server's.

/**
 * Decodes a have-list header value; `undefined` for an absent/empty one.
 * Tolerant of malformed entries (skipped) — a wrong entry costs one
 * unneeded emission, never a wrong skip.
 * @internal
 */
export function decodeHaveList(text: string | null | undefined): Record<string, string> | undefined;

export function decodeHaveList(text) {
  if (!text) return undefined;
  const have = {};
  let any = false;
  for (const entry of text.split(",")) {
    const eq = entry.indexOf("=");
    if (eq === -1) continue;
    const digest = entry.slice(eq + 1).trim();
    if (!/^[0-9a-f]{16}$/.test(digest)) continue;
    have[entry.slice(0, eq).trim()] = digest;
    any = true;
  }
  return any ? have : undefined;
} /**
 * Whether a fetch Response carries a frame stream.
 * @experimental
 */
export function isFrameStreamResponse(response: Response): boolean;

/** Whether a fetch Response carries a frame stream. */
export function isFrameStreamResponse(response) {
  return response.headers.has(FRAME_STREAM_HEADER);
} /**
 * Reads a frame-stream Response to completion, applying every chunk to
 * `host`. Chunks are length-prefixed JSON over the server-function wire
 * framing. Resolves with the id the chunks were applied under once the
 * stream ends; rejects on a malformed or errored stream.
 *
 * @example
 * ```ts
 * const response = await getStory(id); // frame-tagged server function result
 * if (isFrameStreamResponse(response)) {
 *   await applyFrameResponse(response, host, { as: "story-pane" });
 * }
 * ```
 * @experimental
 */
function loadTransportTier() {
  if (!tierLoaders.transport) {
    tierLoaders.transport = () => import("@solidjs/web/frames/transport");
  }
  return prepareTier("transport");
}

export const applyFrameResponse: (
  response: Response,
  host: FrameHost,
  options?: ApplyFrameResponseOptions
) => Promise<string> = (response, host, options) => {
  response.headers.get(FRAME_TIERS_HEADER)?.split(",").forEach(prepareTier);
  const load = loadTransportTier();
  if (load.r) return load.r.applyFrameResponse(response, host, options);
  return load.then(() => tierLoads.transport.r.applyFrameResponse(response, host, options));
};

export const ends = msg => !!msg.r && (":complete" in msg.r || ":error" in msg.r);

/** Brands an inline-rendered server component with its function id. */
export const SERVER_COMPONENT = /*#__PURE__*/ Symbol.for("solid.server-component");

/** The unwrapped server component behind an inline-render wrap. */
export const SERVER_COMPONENT_SOURCE = /*#__PURE__*/ Symbol.for("solid.server-component-source");

/** The call's wire address (`frameAddress`), for regions to be emitted under. */
export const SERVER_COMPONENT_ADDRESS = /*#__PURE__*/ Symbol.for("solid.server-component-address");

/**
 * The binding brand on values the transport resolves: `{ component, address }`
 * (see `createServerComponentHandler`). The identity split (DR-1,
 * docs/server-components-principles.md): `component` is the MOUNT identity —
 * one per server function, stable across every call — while `address` names
 * the call's content store. An equals-gated reader (a framework's `dynamic`)
 * compares `component` across resolutions: same function means "same
 * instance, new binding" — it keeps its mounted instance and delivers the
 * new address into it (the instance's frame re-binds its pull to that
 * address's resident store) — and a different function swaps normally.
 * `Symbol.for`, so consumers honor it without importing this module.
 */
export const COMPONENT_BINDING = /*#__PURE__*/ Symbol.for("solid.component-binding");

// A content TOKEN names one staged response for an address: `address`, the
// separator, the response's version. Mounts receive tokens through their
// address accessor (dynamic treats addresses as opaque, so a new token is
// delivered like an address switch — inside the transition that read it).
// The token is how a refetch of the address a mount SHOWS enters the
// reactive graph at all: `dynamic` delivers a kept resolution only when its
// address differs, so a refetch resolving to the bare address would be a
// write nothing observes, and its content could not be held by the
// transaction that asked for it (C15). NUL never occurs in a function id.
export const CONTENT_TOKEN = "\u0000";

/**
 * The address a content token belongs to; a plain address passes through.
 * @internal
 */
export function contentAddress(token: string): string;

export function contentAddress(token) {
  return token.split(CONTENT_TOKEN)[0];
}

/**
 * The live handler's staged content (see `createServerComponentHandler`),
 * by token; a plain address, or a token already committed or superseded,
 * is a no-op. Mounts call both halves from the render effect that follows
 * their address accessor: `preview` from its compute half — under the
 * transaction that delivered the token, so the slot args it pushes into the
 * live fills (see `FrameHost.preview`) are staged with it and a fill's
 * derivation over an arg re-derives in that pass, never one flush behind
 * the intent it held (principles §9.2.2) — and `commit` from its effect
 * half, landing the buffered response as the store's writes in the commit.
 * Installed by the handler (one active handler at a time, as for
 * `resolveServerComponent` below).
 * @internal
 */
export const stagedContent: {
  preview(token: string): void;
  commit(token: string): void;
} = { preview() {}, commit() {} };

// The live transport registry's resolver, installed by
// createServerComponentHandler. Module state on the config pattern (one
// active handler at a time, a later creation replaces the current one):
// the codec plugin below has no path to the handler instance — codecs are
// configured, handlers are created — and both live in this module, so the
// seam never needs a global.
let resolveServerComponent;

// The call behind an address, as the transport saw it — `{ id, meta, args,
// retry }` — recorded when a response for it is handled (or the document
// answered it). An address is a one-way hash of the call, so this is the
// only way back from "this address errored" to "ask the server again": a
// frame's `:error` is its one async value rejecting (frames-rulings 3.3),
// and the enclosing `<Errored>`'s `reset` re-reads the landing — an errored
// landing is not a landing for a fresh consumer, so the re-read is a new
// flight for the same address, made again through the call's own `retry`
// (the server-function client's thunk for the dispatch it made — see
// `client.ts`, `reask`). Same module-state pattern as
// `resolveServerComponent`; one entry per address, the newest call wins
// (same call, same hash).
const calls = new Map();

/**
 * The call recorded for an address — `{ id, meta, args, retry }`, `retry`
 * the thunk that makes the same call again — or `undefined` for an address
 * no response or document answer named.
 * @internal
 */
export function callFor(
  address: string
): { id: string; meta: unknown; args: unknown[]; retry(): Promise<unknown> } | undefined;

export function callFor(address) {
  return calls.get(address);
}

// The registry bootstrap ships with the FIRST reference each script
// serializes (see `serialize` below) — but the bootstrap text and its
// first-use tracking are server-only weight, so the document-SSR module
// (frame-sink) installs a prefix resolver at load rather than this module
// carrying them: this module is shared with client bundles, whose only
// interest in the plugin is `deserialize`. Unset (an integration
// serializing eval-style without loading the document surface), references
// emit as bare registry reads and the shell must install `_$SC` itself —
// the pre-self-bootstrap contract.
let serverComponentRegistryExpr; /**
 * Installs the hydration-serializer registry prefix: given the emitted
 * script's serializer context, returns the expression the next serialized
 * reference reads the `_$SC` registry through (the self-bootstrapping form
 * on a script's first reference, a bare read after). Loaded document-SSR
 * modules install this (see frame-sink); client bundles never carry the
 * bootstrap text.
 * @experimental
 */
export function setServerComponentBootstrap(resolve: (ctx: unknown) => string): void;

export function setServerComponentBootstrap(resolve) {
  serverComponentRegistryExpr = resolve;
}

/**
 * Seroval plugin for a server component crossing a serialization boundary.
 * A branded component (see `frameTransformDirectResult`) serializes as a
 * REFERENCE — its markup never rides as data.
 *
 * Two distinct consumers share the one tag:
 *
 * - `serialize` (eval-style, the document hydration serializer): emits
 *   `self._$SC.r("<function id>", "<address>")`. The document shell's inline
 *   bootstrap memoizes a stable placeholder per FUNCTION — a delegating
 *   shell whose every mount binds to its own SSR'd element during adoption
 *   — and resolves the addressed reference to the call's BINDING over it
 *   (`COMPONENT_BINDING`, the same shape `bindingFor` below mints), so a
 *   reader that adopted the reference during hydration (an async
 *   `dynamic()` instance's record) holds the same identity a later answer
 *   for the call resolves to.
 * - `deserialize` (the JSON codec): the codec only ever carries a component
 *   inside a single-flight envelope, so this is a FLIGHT reference. It must
 *   resolve to the exact object the reading call site already holds — an
 *   integration seeding its cache with anything else fails the consumer's
 *   equals-gate and remounts the boundary — so it resolves through the live
 *   transport registry by the call's address.
 */
// One parser serves the sync and stream modes (identical signatures); async
// awaits the same two fields.
function parseServerComponent(value, ctx) {
  return {
    id: ctx.parse(value[SERVER_COMPONENT]),
    address: ctx.parse(value[SERVER_COMPONENT_ADDRESS])
  };
}

// A plain descriptor, NOT wrapped in seroval's `createPlugin`: that helper
// is the identity function (it exists for type inference only), and seroval
// ships without `sideEffects: false` — one named import retains the entire
// library in this module's eager graph, defeating the lazy-codec split the
// transports are built around. The JSDoc cast keeps the type contract.
/** @type {import("seroval").Plugin<Function, { id: any, address: any }>} */
export const ServerComponentPlugin = {
  tag: "solid/server-component",
  test(value) {
    return typeof value === "function" && SERVER_COMPONENT in value;
  },
  parse: {
    sync: parseServerComponent,
    async async(value, ctx) {
      return {
        id: await ctx.parse(value[SERVER_COMPONENT]),
        address: await ctx.parse(value[SERVER_COMPONENT_ADDRESS])
      };
    },
    stream: parseServerComponent
  },
  serialize(node, ctx) {
    // The reference resolves per FUNCTION (the bootstrap memoizes one
    // placeholder per id), but it CARRIES the call's address: the bootstrap
    // records address -> id, and the client registers those records with the
    // transport — that record is how a post-load call for the same
    // (function, arguments) finds its way back to the adopted boundary even
    // though the document's value never traveled through the transport.
    //
    // The registry ships WITH the first reference each script serializes —
    // demand-driven, so a document only carries the bootstrap when it
    // actually serializes a server component, and ordering is correct by
    // construction: inline scripts execute in document order, and every
    // script that reads `_$SC` contains (or follows) a script that defined
    // it. Nothing may sit ahead of the authored `<head>` elements — a
    // head-open splice claims as the first walked child and drifts every
    // positional hydration claim after it.
    const registry = serverComponentRegistryExpr ? serverComponentRegistryExpr(ctx) : "self._$SC";
    return registry + ".r(" + ctx.serialize(node.id) + "," + ctx.serialize(node.address) + ")";
  },
  deserialize(node, ctx) {
    const id = ctx.deserialize(node.id);
    const address = ctx.deserialize(node.address);
    if (address !== undefined && resolveServerComponent) {
      return resolveServerComponent(id, address);
    }
    // No transport installed (or an unaddressed brand): fall back to the
    // document registry's per-function placeholder.
    return globalThis._$SC.r(id);
  }
}; /**
 * The codec options for a single-flight envelope: `codec` plus
 * `ServerComponentPlugin` (deduped by tag). Injected by the protocol on both
 * legs; exported for integrations composing their own flight carriers.
 * @experimental
 */
export function flightCodec(codec?: JSONCodecOptions): JSONCodecOptions;

/**
 * The codec options for a single-flight envelope: the configured codec plus
 * `ServerComponentPlugin`. The envelope is the only place a component
 * crosses the codec, and both legs of that path are frame-owned code (the
 * flight transform serializing it, this transport decoding it), so the
 * protocol injects the plugin itself — nothing to register anywhere.
 * (Container traces need no injection here: the trace plugin rides the
 * codec's DEFAULT plugin set — see serializer-decode.js — which keeps its
 * weight in the lazy codec chunk instead of this eager module.)
 */
export function flightCodec(codec) {
  const plugins = (codec && codec.plugins) || [];
  // Tag equality, not instance equality: the two peers (and separately
  // bundled copies of this module) each carry their own plugin object.
  if (plugins.some(plugin => plugin && plugin.tag === ServerComponentPlugin.tag)) return codec;
  return { ...codec, plugins: [...plugins, ServerComponentPlugin] };
} /**
 * The client mirror of `frameTransformResult`, shaped for the server-function
 * client's `responseHandler` seam: frame-stream responses resolve the call
 * with a **binding** — a callable wrapper branded `COMPONENT_BINDING` — so
 * an equals-gated consumer (Solid's `dynamic`) never remounts across
 * refetches or argument changes; the response streams into the address's
 * resident store as the only observable effect.
 *
 * The identity split (DR-1): stores are keyed per-ADDRESS — the call's
 * intrinsic (function, arguments) name, one-to-one with a query cache's
 * per-args entries — while mounts are per-SITE, rendering the per-function
 * component and following delivered addresses. An address nothing is bound
 * to warms its store (preload isolation is the default, not a rule).
 * @experimental
 */
export function createServerComponentHandler<C>(options: ServerComponentHandlerOptions<C>): {
  /**
   * `retry` (the server-function client's thunk for the call it is
   * answering or dispatched, declared shape included) is recorded behind
   * the call's address for the re-ask (`callFor`, frames-rulings 3.3).
   */
  intercept?(info: {
    id: string;
    meta: unknown;
    args: unknown[];
    retry?(): Promise<unknown>;
  }): unknown;
  handle(
    response: Response,
    ctx: {
      id: string;
      meta: unknown;
      args: unknown[];
      context: unknown;
      retry?(): Promise<unknown>;
      /** Observe tier: when the request went out (`performance.now()`). */
      startedAt?: number;
    }
  ): unknown;
  /**
   * A `live()` call was made (before its first fetch): starts the live wire
   * tier's load (`prepareTier("wire")`), so the import races only the
   * request — preload-at-call.
   */
  onLive(): void;
  /**
   * What a `live` (re)connect of the call resumes from (RFC 11 §9.5,
   * Resume request): the address's version ordinal as the position
   * (`Last-Event-ID`) and, when a mount shows the address with a ledger,
   * its have-list under `FRAME_HAVE_HEADER` — omitted over budget, so the
   * render is a full snapshot then. `undefined` when nothing here has
   * shown the call — or while the live wire tier, which keeps the ledger
   * and answers this, is not resident yet (a first connect over content a
   * plain call applied: a full snapshot, the degraded case accepted).
   */
  resume(info: {
    id: string;
    meta: unknown;
    args: unknown[];
  }): { position: string; headers?: Record<string, string> } | undefined;
  /**
   * Declares that the document is showing a call: hydration-data references
   * carry their call's address (`_$SC.r(id, address)`) but never travel
   * through the transport, so the integration forwards those records here.
   * Mints the call's binding, so a post-load refetch resolves a value
   * whose component matches what the document mounted.
   */
  showing(address: string, functionId: string): void;
};

/**
 * The client mirror of `frameTransformResult`, shaped for the server-function
 * client's `responseHandler` seam: frame-stream responses resolve the call
 * with a **binding** instead of data — a callable wrapper branded
 * `COMPONENT_BINDING: { component, address }` — so an equals-gated consumer
 * (Solid's `dynamic`) never remounts across refetches OR argument changes;
 * the response streams into the address's resident store as the only
 * observable effect.
 *
 * The identity split (DR-1, docs/server-components-principles.md):
 *
 * - The **store** is keyed per-ADDRESS — the call's intrinsic
 *   `(function, arguments)` name, the same per-args rule an integration's
 *   query cache keys values by, so the two stay one-to-one and a cached
 *   binding is honest by construction (it names the content it was cached
 *   for; a mount bound to a different address never observes it). Every
 *   response applies AS its call's address; an address nothing is bound to
 *   simply warms its store (a hover preload never touches the page).
 * - The **mount** is keyed per-SITE. `component(fnId)` builds the
 *   framework's mount component once per FUNCTION; every call of that
 *   function resolves a binding wrapping that same component, so a live
 *   site switching arguments passes its reader's equals-gate ("same
 *   component") and receives the new address as a NEW BINDING into the same
 *   instance — the semantics compiled components already have for props.
 *   The instance re-binds its frame's pull to the new address's store:
 *   warm store re-materializes instantly, in-flight stream morphs in.
 *   Client slot state on occurrences whose ids persist survives; there is
 *   no mount to steal, so no handoff protocol, no forwarding, and no
 *   preload special-casing exist.
 *
 * The address reaches the mount as a second argument (`() => address`): an
 * equals-gated reader calls the component itself with a live accessor it
 * updates on delivery; calling the binding directly (a non-gated mount)
 * passes the binding's own constant address.
 */
export function createServerComponentHandler({ host, component, intercept }) {
  // Mount components, one per FUNCTION (the equals-gate identity).
  const byFn = new Map();
  const componentFor = fnId => {
    let comp = byFn.get(fnId);
    if (comp === undefined) byFn.set(fnId, (comp = component(fnId)));
    return comp;
  };
  // Bindings, one per ADDRESS — the stable resolution value for a call
  // (repeat calls, cache reads, and flight references all resolve the
  // identical object). Purely derived: (function component, address) —
  // no routing state lives here.
  const byAddress = new Map();
  const bindingFor = (address, fnId) => {
    let binding = byAddress.get(address);
    if (!binding) {
      const comp = componentFor(fnId);
      // The address rides as a SECOND argument (an accessor): the binding is
      // called, never compiled against, so the convention is free — and it
      // leaves props untouched for the framework's own reactivity. A gated
      // reader that kept its instance calls `component` itself with a LIVE
      // accessor instead; this constant one serves direct mounts.
      binding = props => comp(props, () => address);
      binding[COMPONENT_BINDING] = { component: comp, address };
      byAddress.set(address, binding);
    }
    return binding;
  };
  // Content for a call a mount is SHOWING is staged, not written: the
  // response's chunks buffer under the address until the body ends, and
  // the call resolves a binding to a content token naming that version. The
  // mount's address accessor delivers the token inside the transition that
  // read the call; the follow effect's compute half previews the slot args
  // into the live fills (staged with the transition) and its effect half
  // commits the rest as one run of writes — so new content lands in that
  // transition's commit, alongside everything else it holds, and not when
  // the body happens to finish arriving. The response's DATA is the one
  // part that writes through as it arrives: tables are per response
  // (frames-rulings 1.2 — the host's data path keys them by the chunk's
  // version), so the staged response decodes into its own table while the
  // shown response's stays in place, and the preview resolves the staged
  // args through it. One entry per address: the newest response is the
  // only one worth committing (versions are bumped as responses arrive, so
  // a later stage always supersedes).
  const staged = new Map();
  const latest = new Map();
  const versions = new Map();
  const bump = address => {
    const version = (versions.get(address) || 0) + 1;
    versions.set(address, version);
    staged.delete(address);
    tierLoads.wire?.r?.cancel(host, address);
    return version;
  };
  const begin = (address, version) => host.apply({ type: "start", id: address, version });
  const state = {
    host,
    byAddress,
    bindingFor,
    staged,
    latest,
    calls,
    stagedContent,
    bump,
    begin
  };
  return {
    capture() {
      loadTransportTier();
    },
    intercept:
      intercept &&
      (info => {
        const hit = intercept(info);
        if (hit === undefined) return void (prepareMorph(), loadTransportTier());
        const address = frameAddress(info.id, info.args);
        if (!info.meta?.live) calls.set(address, info);
        const binding = () => bindingFor(address, info.id);
        if (typeof hit.then === "function")
          return hit.then(landed => (landed ? binding() : undefined));
        return binding();
      }),
    onLive() {
      prepareTier("wire");
    },
    resume(info) {
      return tierLoads.wire?.r?.resume(host, info, versions);
    },
    handle(response, ctx) {
      if (!isFrameStreamResponse(response)) return undefined;
      response.headers.get(FRAME_TIERS_HEADER)?.split(",").forEach(prepareTier);
      const wire = ctx[LIVE_WIRE];
      if (wire) {
        const address = frameAddress(ctx.id, ctx.args);
        const binding = bindingFor(address, ctx.id);
        return prepareTier("wire").then(() =>
          tierLoads.wire.r.connect(response, wire, address, binding, host, bump, begin)
        );
      }
      const load = loadTransportTier();
      if (load.r) return load.r.handleResponse(state, response, ctx);
      return load.then(() => tierLoads.transport.r.handleResponse(state, response, ctx));
    },
    showing(address, functionId) {
      bindingFor(address, functionId);
    }
  };
}
