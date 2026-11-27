// @ts-nocheck
import { actionDepth } from "solid-js/internal";
import type { ServerFunction, ServerFunctionMetadata } from "./shared.js";
import {
  LIVE_LOCAL,
  LIVE_RESUME_FROM,
  LIVE_SOURCE,
  LIVE_WIRE,
  SERVER_FUNCTION_INVOKE,
  SERVER_FUNCTION_METADATA,
  configureServerFunctionsCodec,
  getServerFunctionMetadata,
  isServerFunction,
  parseServerFunctionAddress,
  provideServerFunctionRPC,
  serverFunctionActionUrlFor,
  serverFunctionAddress,
  serverFunctionDataAddress,
  serverFunctionLiveAddress,
  serverFunctionUrlFor,
  withMeta
} from "./shared.js";

export {
  ChunkReader,
  ERROR_HEADER,
  EVENT_STREAM_HEARTBEAT,
  EventStreamReader,
  FLASH_COOKIE,
  LAST_EVENT_ID_HEADER,
  LIVE_WIRE,
  REDIRECT_HEADER,
  SERVER_FUNCTION_INVOKE,
  SINGLE_FLIGHT_HEADER,
  UNKNOWN_HEADER,
  clearFlashCookie,
  createChunk,
  createEventChunk,
  decodeErrorHeaderValue,
  decodeRedirectHeaderValue,
  decodeResponse,
  decodeResponsePayload,
  deliverFlightData,
  deserializeStream,
  encodeErrorHeaderValue,
  frameAddress,
  getFlightDataConsumer,
  getFlightDataSourceIds,
  getServerFunctionMetadata,
  getServerFunctionsCodec,
  hasFlashCookie,
  hasFlightMetadata,
  invoke,
  isEventStream,
  isServerFunction,
  positionDigest,
  serializeString,
  serverFunctionDataAddress,
  serverFunctionLiveAddress,
  subscribeFlightData,
  withMeta
} from "./shared.js";
export { REVALIDATE_HEADER } from "../../src/response.js";

import { JSONCodecOptions } from "../../serialization/src/serializer-decode.js";

export type {
  FlightDataConsumer,
  FlightDataContext,
  InvokeOptions,
  ServerFunction,
  ServerFunctionInvoker,
  ServerFunctionMetadata,
  SingleFlightPayload
} from "./shared.js";

export interface PrepareRequestContext {
  id: string;
  meta: ServerFunctionMetadata | undefined;
}

export type PrepareRequestHook = (
  init: RequestInit,
  context: PrepareRequestContext
) => RequestInit | Promise<RequestInit>;

export type ServerFunctionsSend = (
  address: string,
  init: RequestInit
) => Response | Promise<Response>;

export interface ServerFunctionsClientConfig {
  endpoint?: string;
  codec?: JSONCodecOptions;
  fetch?: ServerFunctionsSend | null;
  prepareRequest?: PrepareRequestHook;
  responseHandler?: {
    capture?(info: { id: string; meta: unknown }): unknown;
    handle(
      response: Response,
      ctx: {
        id: string;
        meta: unknown;
        args: unknown[];
        context: unknown;
        retry(): Promise<unknown>;
        startedAt?: number;
      }
    ): unknown;
    intercept?(info: {
      id: string;
      meta: unknown;
      args: unknown[];
      retry(): Promise<unknown>;
    }): unknown;
    resume?(info: {
      id: string;
      meta: unknown;
      args: unknown[];
    }): { position?: string; headers?: Record<string, string> } | undefined;
    onLive?(): void;
  };
  serializeArgs?(args: unknown[]): string | FormData | Promise<string | FormData>;
}

export type LiveSourceStatus = "connected" | "reconnecting" | "closed";

export type LiveSource<R> = R & {
  onstatus?: (state: LiveSourceStatus, error?: unknown) => void;
};

export interface ServerFunctionInvocation {
  id: string;
}

export interface LiveServerFunction<A extends readonly any[] = any[], R = any> {
  (...args: A): LiveSource<R>;
  readonly id: string;
  readonly url: string;
}

const config = {
  endpoint: "/_server",
  fetch: undefined,
  prepareRequest: undefined,
  responseHandler: undefined,
  serializeArgs: undefined
};

/** @internal — shared with `@solidjs/web/server-functions/transport`. */
export const _sfConfig = config;

const NATIVE_PROMISE = Promise;

let transportMod;
let transportLoading;
function loadTransport() {
  if (transportMod) return transportMod;
  return (transportLoading ||= import("@solidjs/web/server-functions/transport").then(
    m => (transportMod = m),
    err => {
      transportLoading = undefined;
      throw err;
    }
  ));
}

function sendViaTransport(base, id, options, args, meta, callArgs = args) {
  if (Promise !== NATIVE_PROMISE) return new Promise(() => {});
  const handler = config.responseHandler;
  const context = handler && handler.capture ? handler.capture({ id, meta }) : undefined;
  const inAction = actionDepth;
  if (transportMod)
    return transportMod.fetchServerFunction(base, id, options, args, meta, callArgs, context, inAction);
  return loadTransport().then(m =>
    m.fetchServerFunction(base, id, options, args, meta, callArgs, context, inAction)
  );
}

function sendGetViaTransport(id, metadata, args, invokeOptions) {
  if (Promise !== NATIVE_PROMISE) return new Promise(() => {});
  const handler = config.responseHandler;
  const context = handler && handler.capture ? handler.capture({ id, meta: metadata }) : undefined;
  if (transportMod) return transportMod.sendGet(id, metadata, args, invokeOptions, context);
  return loadTransport().then(m => m.sendGet(id, metadata, args, invokeOptions, context));
}

export function serverFunctionUrl<A extends readonly unknown[]>(
  fn: ServerFunction<A, any>,
  ...args: A
): string;
export function serverFunctionUrl(fn, ...args) {
  return serverFunctionUrlFor(config.endpoint, fn, args);
}

export function serverFunctionActionUrl(
  fn: ServerFunction | string,
  ...boundArgs: readonly unknown[]
): string;
export function serverFunctionActionUrl(fn, ...boundArgs) {
  return serverFunctionActionUrlFor(config.endpoint, fn, boundArgs);
}

export function parseServerFunctionActionUrl(url: string): string | null;
export function parseServerFunctionActionUrl(url) {
  const parsed = parseServerFunctionAddress(
    new URL(url, globalThis.location?.href || "http://localhost").pathname,
    config.endpoint
  );
  return parsed && parsed.id;
}

export function configureServerFunctionsClient(config?: ServerFunctionsClientConfig): void;
export function configureServerFunctionsClient({
  endpoint,
  codec,
  fetch,
  prepareRequest,
  responseHandler,
  serializeArgs
} = {}) {
  if (endpoint !== undefined) config.endpoint = endpoint;
  if (codec !== undefined) configureServerFunctionsCodec(codec);
  if (fetch !== undefined) config.fetch = fetch;
  if (prepareRequest !== undefined) config.prepareRequest = prepareRequest;
  if (responseHandler !== undefined) config.responseHandler = responseHandler;
  if (serializeArgs !== undefined) config.serializeArgs = serializeArgs;
}

let rpc;
function provideRPC() {
  if (rpc) return;
  provideServerFunctionRPC(
    (rpc = {
      GET,
      decodeResponse: (response, codec) =>
        transportMod
          ? transportMod.decodeResponse(response, codec)
          : loadTransport().then(m => m.decodeResponse(response, codec))
    })
  );
}

function siblingAddressFor(base, kind) {
  const splitAt = base.search(/[?#]/);
  const path = splitAt < 0 ? base : base.slice(0, splitAt);
  const rest = splitAt < 0 ? "" : base.slice(splitAt);
  const slash = path.lastIndexOf("/");
  if (path.endsWith(`/${kind}/`, slash + 1)) return base;
  return `${path.slice(0, slash + 1)}${kind}/${path.slice(slash + 1)}${rest}`;
}
const dataAddressFor = base => siblingAddressFor(base, "data");

export function createServerReference(id: string, name?: string, base?: string): ServerFunction;
export function createServerReference(id, name, base) {
  provideRPC();
  const metadata = name === undefined ? {} : { name };
  const run = (args, invokeOptions) => {
    const send = () =>
      sendViaTransport(
        base ? dataAddressFor(base) : serverFunctionDataAddress(config.endpoint, id),
        id,
        invokeOptions ? { ...invokeOptions } : {},
        args,
        metadata
      );
    const handler = config.responseHandler;
    if (handler && handler.intercept && !adoptedCall(invokeOptions)) {
      const hit = handler.intercept({ id, meta: metadata, args, retry: send });
      if (hit !== undefined) return localOrSend(hit, send);
    }
    return send();
  };
  const fn = (...args) => run(args);
  fn[SERVER_FUNCTION_METADATA] = metadata;
  fn[SERVER_FUNCTION_INVOKE] = run;

  return new Proxy(fn, {
    get(target, prop) {
      if (prop === "id") return id;
      if (prop === "url") {
        return base || serverFunctionAddress(config.endpoint, id);
      }
      return target[prop];
    }
  });
}

export function GET<A extends readonly any[], R>(
  fn: (...args: A) => R
): ServerFunction<A, Awaited<R>>;
export function GET(fn) {
  if (!isServerFunction(fn)) {
    throw new Error("GET expects a server function reference");
  }
  provideRPC();
  const id = fn.id;
  const metadata = { ...getServerFunctionMetadata(fn) };
  const run = async (args, invokeOptions) => {
    const handler = config.responseHandler;
    if (handler && handler.intercept && !adoptedCall(invokeOptions)) {
      const retry = () => sendGetViaTransport(id, metadata, args, invokeOptions);
      const hit = handler.intercept({ id, meta: metadata, args, retry });
      if (hit !== undefined) return localOrSend(hit, retry);
    }
    return sendGetViaTransport(id, metadata, args, invokeOptions);
  };
  const wrapped = (...args) => run(args);
  wrapped[SERVER_FUNCTION_METADATA] = metadata;
  wrapped[SERVER_FUNCTION_INVOKE] = run;
  wrapped.id = id;
  Object.defineProperty(wrapped, "url", {
    get: () => serverFunctionAddress(config.endpoint, id),
    configurable: true
  });
  return withMeta(wrapped, { method: "GET" });
}

export function broadcast<A extends readonly any[], R>(
  fn: (...args: A) => R
): LiveServerFunction<A, R>;
export function broadcast(fn) {
  return live(fn);
}

function localOrSend(hit, send) {
  if (hit === null || typeof hit.then !== "function") return hit;
  return hit.then(answer => (answer === undefined ? send() : answer));
}

function adoptedCall(options) {
  const wire = options && options[LIVE_WIRE];
  return !!(wire && wire.adopted);
}

export function live<A extends readonly any[], R>(
  fn: (...args: A) => R
): LiveServerFunction<A, R>;
export function live(fn) {
  if (!isServerFunction(fn)) {
    throw new Error("live expects a server function reference");
  }
  if (getServerFunctionMetadata(fn)?.method !== "GET") fn = rpc.GET(fn);
  const id = fn.id;
  const metadata = { ...getServerFunctionMetadata(fn), live: true };
  const makeIterable = (args, invokeOptions) => {
    const handler = config.responseHandler;
    handler && handler.onLive && handler.onLive();
    const local =
      handler && handler.intercept ? handler.intercept({ id, meta: metadata, args }) : undefined;
    const iterable = {
      [LIVE_SOURCE]: true,
      [Symbol.asyncIterator]() {
        const origResume = iterable[LIVE_RESUME_FROM];
        let resume = origResume;
        let seed = iterable[LIVE_LOCAL];
        let adopted = origResume !== undefined;
        let stopped = false;
        let closed = false;
        let loop;
        const DONE = { done: true, value: undefined };
        const pull = async () => {
          if (resume !== undefined) {
            const value = resume;
            resume = undefined;
            if (!stopped) return { done: false, value };
          }
          if (seed !== undefined) {
            const value = typeof seed.then === "function" ? await seed : seed;
            seed = undefined;
            if (value !== undefined) {
              adopted = true;
              if (!stopped) return { done: false, value };
            }
          }
          if (stopped) return DONE;
          if (!loop) {
            const m = transportMod || (await loadTransport());
            if (stopped) return DONE;
            loop = m.createLiveLoop({
              id,
              metadata,
              fn,
              args,
              invokeOptions,
              iterable,
              resume: origResume,
              seed: undefined,
              adopted
            });
          }
          return loop.next();
        };
        return {
          next: () => pull(),
          return(value) {
            stopped = true;
            if (loop) return loop.return(value);
            if (!closed) {
              closed = true;
              try {
                iterable.onstatus && iterable.onstatus("closed");
              } catch {}
            }
            return Promise.resolve({ done: true, value });
          }
        };
      }
    };
    if (local !== undefined) iterable[LIVE_LOCAL] = local;
    return iterable;
  };
  const wrapped = (...args) => makeIterable(args);
  wrapped[SERVER_FUNCTION_METADATA] = metadata;
  wrapped[SERVER_FUNCTION_INVOKE] = makeIterable;
  wrapped.id = id;
  Object.defineProperty(wrapped, "url", {
    get: () => fn.url,
    configurable: true
  });
  return wrapped;
}

export function registerServerReference(): never;
export function registerServerReference() {
  throw new Error("registerServerReference must not be called in the client build");
}

export function getServerFunctionInvocation(): ServerFunctionInvocation | undefined;
export function getServerFunctionInvocation() {
  return undefined;
}
