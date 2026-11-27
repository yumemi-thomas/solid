// @ts-nocheck
import { REVALIDATE_HEADER } from "../../src/response.js";
import { observeCall } from "../../src/observe.js";
import {
  _sfConfig as config,
  LIVE_WIRE,
  SERVER_FUNCTION_INVOKE,
  getFlightDataConsumer,
  getFlightDataSourceIds,
  getServerFunctionsCodec,
  serverFunctionDataAddress,
  serverFunctionLiveAddress
} from "./client.js";
import {
  BODY_FORMAT_HEADER,
  BodyFormat,
  ChunkReader,
  ERROR_HEADER,
  EventStreamReader,
  LAST_EVENT_ID_HEADER,
  MAX_GET_URL_LENGTH,
  REDIRECT_HEADER,
  SINGLE_FLIGHT_HEADER,
  UNKNOWN_HEADER,
  createChunk,
  decodeResponse as sharedDecodeResponse,
  deserializeStream,
  extractBody,
  getHeadersAndBody,
  hasFlightMetadata,
  isEventStream,
  isJSONSafe,
  positionDigest
} from "./shared.js";

const IS_OBSERVE = "_SOLID_OBSERVE_" as unknown as boolean;
const IS_DEV = "_SOLID_DEV_" as unknown as boolean;
const CALL_OBSERVATION = Symbol("solid.CallObservation");

export {
  ChunkReader,
  ERROR_HEADER,
  EventStreamReader,
  SINGLE_FLIGHT_HEADER,
  createChunk,
  deserializeStream,
  hasFlightMetadata,
  isEventStream,
  positionDigest
};

export async function deliverFlightData(response, data) {
  if (data)
    await Promise.allSettled(
      Object.values(data).flatMap(s => (s && typeof s == "object" ? Object.values(s) : []))
    );
  const folded = response.headers.get(SINGLE_FLIGHT_HEADER)?.split(",");
  const metadata = !folded || hasFlightMetadata(response);
  for (const source of getFlightDataSourceIds()) {
    if (!metadata && !folded.includes(source)) continue;
    const consumer = getFlightDataConsumer(source);
    if (consumer) await consumer(data ? data[source] : undefined, { response });
  }
}

export function decodeResponse(response, codecOptions) {
  return sharedDecodeResponse(response, codecOptions ?? getServerFunctionsCodec());
}

function serializeArguments(args) {
  if (!config.serializeArgs) {
    throw new Error(
      "Server function arguments are sent as JSON by default and these " +
        "arguments are not JSON-serializable. Call enableRichArguments() " +
        '(from "@solidjs/web/server-functions/rich-args") once at startup ' +
        "to send Dates, Maps, Sets, typed arrays, files, etc. through the codec — " +
        "or pass a single Blob/FormData/File argument, which has a native " +
        "HTTP encoding."
    );
  }
  return config.serializeArgs(args);
}

function serverFunctionFailure(response, value) {
  const unknown = response.headers.get(UNKNOWN_HEADER) !== null;
  const error =
    value ??
    new Error(
      unknown
        ? "Server function is not part of the deployment that answered (version skew or removed function)"
        : `Server function call failed with status ${response.status}`
    );
  if (error instanceof Error && !("status" in error)) {
    error.status = response.status;
    const retryAfter = parseRetryAfter(response.headers.get("Retry-After"));
    if (retryAfter !== undefined) error.retryAfter = retryAfter;
  }
  if (unknown && error instanceof Error) error.unknownFunction = true;
  return error;
}

function parseRetryAfter(header) {
  if (!header) return undefined;
  const trimmed = header.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const date = Date.parse(trimmed);
  if (!Number.isNaN(date)) return Math.max(0, Math.ceil((date - Date.now()) / 1000));
  return undefined;
}

function isReadCall(options) {
  return !!options.read || (!!options.method && options.method.toUpperCase() === "GET");
}

async function createRequest(base, id, options, meta) {
  const headers = { ...options.headers };
  const wire = options[LIVE_WIRE];
  if (wire) {
    options = { ...options };
    delete options[LIVE_WIRE];
    if (wire.position !== undefined) headers[LAST_EVENT_ID_HEADER] = wire.position;
    if (wire.headers) Object.assign(headers, wire.headers);
  }
  const observation = IS_OBSERVE ? options[CALL_OBSERVATION] : undefined;
  if (observation) {
    options = { ...options };
    delete options[CALL_OBSERVATION];
  }
  let init = {
    method: "POST",
    ...options,
    headers
  };
  if (config.prepareRequest) {
    let prepared = config.prepareRequest(init, { id, meta });
    if (prepared && typeof prepared.then === "function") prepared = await prepared;
    if (prepared && prepared !== init) {
      if (typeof prepared !== "object") {
        throw new Error(
          "prepareRequest must return (or mutate and return) the RequestInit it received; " +
            `it returned a ${typeof prepared}. Spread the init: ` +
            "init => ({ ...init, headers: { ...init.headers, ... } })"
        );
      }
      if (
        typeof prepared.method !== "string" ||
        prepared.method.toUpperCase() !== init.method.toUpperCase()
      ) {
        throw new Error(
          `prepareRequest returned an init without the transport's ${init.method} method, ` +
            "which would send the call without its payload or protocol. Spread the init it " +
            "received: init => ({ ...init, headers: { ...init.headers, ... } })"
        );
      }
    }
    init = prepared || init;
  }
  if (IS_OBSERVE && observation) observation.request(base, init);
  const send = config.fetch || fetch;
  return (meta.fetch || send)(base, init, send);
}

async function initializeResponse(base, id, options, args, meta) {
  if (args.length === 0) {
    return createRequest(base, id, options, meta);
  }
  if (args.length === 1) {
    const result = getHeadersAndBody(args[0]);
    if (result) {
      return createRequest(
        base,
        id,
        {
          ...options,
          body: result.body,
          headers: {
            ...options.headers,
            ...result.headers
          }
        },
        meta
      );
    }
  }
  try {
    if (isJSONSafe(args)) {
      return createRequest(
        base,
        id,
        {
          ...options,
          body: JSON.stringify(args),
          headers: {
            ...options.headers,
            "Content-Type": "application/json",
            [BODY_FORMAT_HEADER]: BodyFormat.Json
          }
        },
        meta
      );
    }
  } catch {
    // fall through to the codec
  }
  if (args.length > 1) {
    try {
      const last = args[args.length - 1];
      const trailing = typeof last !== "string" && getHeadersAndBody(last);
      const leading = args.slice(0, -1).map(arg => (arg === undefined ? null : arg));
      if (trailing && isJSONSafe(leading)) {
        const target =
          base +
          (base.includes("?") ? "&" : "?") +
          "args=" +
          encodeURIComponent(JSON.stringify(leading));
        return createRequest(
          target,
          id,
          {
            ...options,
            body: trailing.body,
            headers: {
              ...options.headers,
              ...trailing.headers
            }
          },
          meta
        );
      }
    } catch {
      // fall through to the codec
    }
  }
  return createRequest(
    base,
    id,
    {
      ...options,
      body: await serializeArguments(args),
      headers: {
        ...options.headers,
        [BODY_FORMAT_HEADER]: BodyFormat.Serialized
      }
    },
    meta
  );
}

async function observedFetch(
  base,
  id,
  options,
  args,
  meta,
  callArgs = args,
  context,
  inAction
) {
  const observation = observeCall(
    id,
    options.method && options.method.toUpperCase() === "GET" ? "GET" : "POST",
    callArgs,
    meta && meta.name
  );
  if (!observation)
    return dispatchServerFunction(base, id, options, args, meta, callArgs, context, inAction);
  let result;
  try {
    result = await dispatchServerFunction(
      base,
      id,
      options,
      args,
      meta,
      callArgs,
      context,
      inAction,
      observation
    );
  } catch (error) {
    observation.settle("error", error);
    throw error;
  }
  observation.settle("ok", result);
  return result;
}

export const fetchServerFunction = IS_OBSERVE ? observedFetch : dispatchServerFunction;

async function dispatchServerFunction(
  base,
  id,
  options,
  args,
  meta,
  callArgs = args,
  context,
  inAction,
  observation
) {
  const handler = config.responseHandler;
  const sources = getFlightDataSourceIds();
  const mutation = !isReadCall(options) && sources.length > 0;
  const acted = mutation && inAction;
  if (acted)
    options = { ...options, headers: { ...options.headers, [SINGLE_FLIGHT_HEADER]: sources + "" } };
  const sent = options;

  const controller = options.signal ? undefined : new AbortController();
  if (controller) options = { ...options, signal: controller.signal };
  if (IS_OBSERVE && observation) options = { ...options, [CALL_OBSERVATION]: observation };

  const startedAt = IS_OBSERVE && handler ? performance.now() : undefined;
  const response = await initializeResponse(base, id, options, args, meta);
  if (IS_OBSERVE && observation) observation.response(response);

  if (handler) {
    const ctx = {
      id,
      meta,
      args: callArgs,
      context,
      retry: () =>
        fetchServerFunction(
          base,
          id,
          sent,
          args,
          meta,
          callArgs,
          handler.capture ? handler.capture({ id, meta }) : undefined,
          0
        )
    };
    if (IS_OBSERVE) ctx.startedAt = startedAt;
    if (options[LIVE_WIRE]) ctx[LIVE_WIRE] = options[LIVE_WIRE];
    const handled = handler.handle(response, ctx);
    if (handled !== undefined) return handled;
  }

  if (response.status >= 400 && !response.headers.has(BODY_FORMAT_HEADER)) {
    throw serverFunctionFailure(response, undefined);
  }

  const failed = response.headers.has(ERROR_HEADER);

  if (mutation) {
    const folded = response.headers.has(SINGLE_FLIGHT_HEADER);
    const metadata = hasFlightMetadata(response);
    if (metadata || folded) {
      const decoded = response.body
        ? await extractBody(response, getServerFunctionsCodec())
        : undefined;
      const enveloped = folded && decoded !== undefined;
      const value = enveloped ? decoded.value : decoded;
      await deliverFlightData(response, enveloped ? decoded.data : undefined);
      if (failed && !metadata) {
        throw serverFunctionFailure(response, value);
      }
      return value;
    }
  }

  if (
    response.headers.has(REDIRECT_HEADER) ||
    response.headers.has(REVALIDATE_HEADER) ||
    response.headers.has(SINGLE_FLIGHT_HEADER) ||
    (response.status >= 300 && response.status < 400 && response.status !== 304)
  ) {
    return response;
  }

  if (
    response.status < 300 &&
    !response.headers.has(BODY_FORMAT_HEADER) &&
    !response.headers.has("X-Content-Raw")
  ) {
    throw serverFunctionFailure(
      response,
      new Error(
        `Server function response carries no recognized encoding (status ${response.status}` +
          `${
            response.headers.get("Content-Type")
              ? `, content-type ${response.headers.get("Content-Type")}`
              : ""
          }): answered by something other than the server function runtime`
      )
    );
  }

  const result = response.body
    ? await extractBody(response, getServerFunctionsCodec(), options[LIVE_WIRE])
    : undefined;
  if (failed) {
    throw serverFunctionFailure(response, result);
  }
  if (acted) await deliverFlightData(response);
  if (controller && result?.[Symbol.asyncIterator] && !result.getReader) {
    return {
      [Symbol.asyncIterator]() {
        const it = result[Symbol.asyncIterator]();
        return {
          next: () => it.next(),
          return: value => (controller.abort(), Promise.resolve({ done: true, value }))
        };
      }
    };
  }
  return result;
}

export async function sendGet(id, metadata, args, invokeOptions, context) {
  const opts = invokeOptions || {};
  const address = opts[LIVE_WIRE]
    ? serverFunctionLiveAddress(config.endpoint, id)
    : serverFunctionDataAddress(config.endpoint, id);
  if (!args.length) {
    return fetchServerFunction(address, id, { ...opts, method: "GET" }, [], metadata, args, context, 0);
  }
  const encoded = isJSONSafe(args) ? JSON.stringify(args) : await serializeArguments(args);
  const url = `${address}?args=${encodeURIComponent(encoded)}`;
  const absolute = new URL(url, globalThis.location?.href || "http://localhost").href;
  if (absolute.length > MAX_GET_URL_LENGTH) {
    return fetchServerFunction(address, id, { ...opts, read: true }, args, metadata, args, context, 0);
  }
  return fetchServerFunction(url, id, { ...opts, method: "GET" }, [], metadata, args, context, 0);
}

const openLiveConnections = IS_DEV ? new Map() : undefined;
let warnedHttp1 = false;
function trackLiveConnection(id, open) {
  const count = openLiveConnections.get(id) || 0;
  if (open) openLiveConnections.set(id, count + 1);
  else if (count > 1) openLiveConnections.set(id, count - 1);
  else openLiveConnections.delete(id);
  if (!open || warnedHttp1) return;
  let total = 0;
  for (const n of openLiveConnections.values()) total += n;
  if (total <= 5) return;
  const navigation =
    typeof performance !== "undefined" && typeof performance.getEntriesByType === "function"
      ? performance.getEntriesByType("navigation")[0]
      : undefined;
  const protocol = navigation && navigation.nextHopProtocol;
  if (typeof protocol !== "string" || !/^http\/1(\.[01])?$/.test(protocol)) return;
  warnedHttp1 = true;
  const names = [...openLiveConnections].map(([fnId, n]) => (n > 1 ? `${fnId} ×${n}` : fnId));
  console.warn(
    `live: ${total} live connections are open (${names.join(", ")}) and this page was served ` +
      `over ${protocol}. Browsers allow six connections per origin under HTTP/1.1, so the next ` +
      `request to this origin — a navigation, a fetch, an image — waits behind them. live ` +
      `requires HTTP/2: the dev server speaks it with \`server.https\`; production hosts do by default.`
  );
}

export function createLiveLoop({ id, metadata, fn, args, invokeOptions, iterable, resume, seed, adopted }) {
  let it;
  let connected = false;
  let attempts = 0;
  let stopped = false;
  let closed = false;
  let ended;
  let timer, wake;
  const DONE = { done: true, value: undefined };
  const invokeSignal = invokeOptions && invokeOptions.signal;
  const controller = new AbortController();
  const wire = {
    position: resume !== undefined ? positionDigest(resume) : undefined,
    connection: undefined,
    adopted: !!adopted || resume !== undefined,
    open: body => new EventStreamReader(body, wire)
  };
  const ends = [];
  const settle = (end, error) => {
    try {
      error !== undefined ? end.sweep() : end.close();
    } catch {}
  };
  const settleAll = error => {
    while (ends.length) settle(ends.pop(), error);
  };
  const wireOptions = {
    ...invokeOptions,
    [LIVE_WIRE]: wire,
    signal: invokeSignal
      ? AbortSignal.any([invokeSignal, controller.signal])
      : controller.signal
  };
  const emit = (state, error) => {
    try {
      iterable.onstatus && iterable.onstatus(state, error);
    } catch {}
  };
  let counted = false;
  const track = open => {
    if (!IS_DEV || open === counted) return;
    counted = open;
    trackLiveConnection(id, open);
  };
  const emitClosed = error => {
    track(false);
    settleAll(error);
    if (ended) ended.then(end => settle(end, error));
    if (closed) return;
    closed = true;
    emit("closed", error);
  };
  const closeIt = value => {
    track(false);
    const current = it;
    it = undefined;
    if (current) {
      try {
        const r = current.return && current.return(value);
        if (r && typeof r.then === "function") r.then(undefined, () => {});
      } catch {}
    }
  };
  const callOnce = () => {
    const handler = config.responseHandler;
    if (handler && handler.resume) {
      const from = handler.resume({ id, meta: metadata, args });
      wire.headers = from ? from.headers : undefined;
      if (from && from.position !== undefined) wire.position = from.position;
    }
    return fn[SERVER_FUNCTION_INVOKE](args, wireOptions);
  };
  const pull = async () => {
    while (!stopped) {
      try {
        if (!it) {
          const connection = (wire.connection = { ended: undefined });
          const result = await callOnce();
          connected = true;
          ended = connection.ended;
          it =
            result !== null && typeof result === "object" && result[Symbol.asyncIterator]
              ? result[Symbol.asyncIterator]()
              : (async function* () {
                  yield result;
                })();
          if (stopped) {
            closeIt();
            controller.abort();
            return DONE;
          }
          track(true);
          emit("connected");
        }
        const r = await (ended
          ? Promise.race([it.next(), ended.then(end => ({ end }))])
          : it.next());
        if (r.end || r.done) {
          const end = r.end || (ended && (await ended));
          if (end && end.open > 0) {
            ends.push(end);
            throw end.error;
          }
          if (end) settle(end);
          emitClosed();
          return DONE;
        }
        if (stopped) return DONE;
        attempts = 0;
        return r;
      } catch (error) {
        if (stopped) return DONE;
        if (!connected) throw error;
        if (invokeSignal && invokeSignal.aborted) {
          stopped = true;
          emitClosed(error);
          throw error;
        }
        if (
          error !== null &&
          typeof error === "object" &&
          typeof error.status === "number" &&
          error.status >= 400 &&
          error.status < 500 &&
          error.status !== 408 &&
          error.status !== 425 &&
          error.status !== 429 &&
          typeof error.retryAfter !== "number"
        ) {
          stopped = true;
          emitClosed(error);
          throw error;
        }
        closeIt();
        emit("reconnecting", error);
        await new Promise(resolve => {
          wake = resolve;
          const named =
            error !== null &&
            typeof error === "object" &&
            typeof error.retryAfter === "number"
              ? Math.min(error.retryAfter * 1000, 60000)
              : undefined;
          timer = setTimeout(resolve, named ?? Math.min(500 * 2 ** attempts++, 10000));
          if (typeof addEventListener === "function")
            addEventListener("online", resolve, { once: true });
          if (invokeSignal) invokeSignal.addEventListener("abort", resolve, { once: true });
        });
        clearTimeout(timer);
        if (typeof removeEventListener === "function") removeEventListener("online", wake);
        if (invokeSignal) invokeSignal.removeEventListener("abort", wake);
        timer = wake = undefined;
      }
    }
    return DONE;
  };
  return {
    next: () => pull(),
    return(value) {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
      if (wake) wake();
      closeIt(value);
      controller.abort();
      emitClosed();
      return Promise.resolve({ done: true, value });
    }
  };
}
