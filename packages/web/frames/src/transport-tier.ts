// @ts-nocheck
import { observeFrameApply } from "../../src/observe.js";
import {
  LIVE_WIRE,
  frameAddress,
  getServerFunctionsCodec
} from "@solidjs/web/server-functions/client";
import {
  ChunkReader,
  ERROR_HEADER,
  SINGLE_FLIGHT_HEADER,
  createChunk,
  deliverFlightData,
  deserializeStream,
  hasFlightMetadata
} from "@solidjs/web/server-functions/transport";
import { prepareTier } from "./client.js";
import {
  COMPONENT_BINDING,
  CONTENT_TOKEN,
  FRAME_STREAM_HEADER,
  FRAME_TIERS_HEADER,
  contentAddress,
  ends
} from "./frame-transport.js";

const IS_OBSERVE = "_SOLID_OBSERVE_" as unknown as boolean;

const readsData = msg => {
  for (const key in msg.r)
    if (key.startsWith("slot:"))
      for (const v of Object.values(msg.r[key].args)) if (v && v.$ref) return true;
  return false;
};

async function observedApplyFrameResponse(response, host, options = {}) {
  const observation = observeFrameApply(response);
  if (!observation) return applyFrames(response, host, options);
  let applied;
  try {
    applied = await applyFrames(response, host, options, observation);
  } catch (error) {
    observation.end(error);
    throw error;
  }
  observation.end();
  return applied;
}

function applyFrames(response, host, options = {}, observation) {
  const rootId = response.headers.get(FRAME_STREAM_HEADER) ?? "";
  response.headers.get(FRAME_TIERS_HEADER)?.split(",").forEach(prepareTier);
  const as = options.as;
  const version = options.version;
  const perFrame = typeof version === "function" ? new Map() : null;
  const reader = options[LIVE_WIRE] || new ChunkReader(response.body);
  const open = new Map();
  const errorRecord = (id, error) => ({
    id,
    version: open.get(id),
    r: { ":error": { message: String(error && error.message) } }
  });
  const drain = async () => {
    let result = await reader.next();
    while (!result.done) {
      const chunk = JSON.parse(result.value);
      if (chunk.type === "outcome") {
        if (options.onOutcome) options.onOutcome(chunk.payload);
      } else {
        const wireId = chunk.id;
        if (as !== undefined && chunk.id === rootId) chunk.id = as;
        if (perFrame) {
          let v = perFrame.get(chunk.id);
          if (v === undefined) perFrame.set(chunk.id, (v = version(chunk.id)));
          chunk.version = v;
        } else if (version !== undefined) chunk.version = version;
        if (chunk.type === "start") open.set(chunk.id, chunk.version);
        else if (ends(chunk)) open.delete(chunk.id);
        if (IS_OBSERVE && observation) observation.chunk(chunk, wireId);
        const needs = chunk.tiers?.map(prepareTier) || [];
        if (chunk.type === "data" || readsData(chunk))
          await Promise.all([host.prepareData?.(), ...needs]);
        host.apply(chunk);
      }
      result = await reader.next();
    }
  };
  const end = error => {
    if (error === undefined)
      for (const id of open.keys())
        host.apply(errorRecord(id, new Error("Frame stream ended before the frame completed.")));
  };
  return drain().then(
    () => {
      end(undefined);
      return as !== undefined ? as : rootId;
    },
    error => {
      end(error);
      throw error;
    }
  );
}

export const applyFrameResponse = IS_OBSERVE ? observedApplyFrameResponse : applyFrames;

let resolveServerComponent;

const ServerComponentClientPlugin = {
  tag: "solid/server-component",
  test() {
    return false;
  },
  parse: {
    sync() {},
    async() {},
    stream() {}
  },
  serialize() {
    return "";
  },
  deserialize(node, ctx) {
    return resolveServerComponent(ctx.deserialize(node.id), ctx.deserialize(node.address));
  }
};

function flightCodec(codec) {
  const plugins = (codec && codec.plugins) || [];
  if (plugins.some(plugin => plugin && plugin.tag === ServerComponentClientPlugin.tag)) return codec;
  return { ...codec, plugins: [...plugins, ServerComponentClientPlugin] };
}

export function handleResponse(state, response, ctx) {
  const { host, byAddress, bindingFor, staged, latest, calls, stagedContent, bump, begin } = state;
  const stage = (address, base, version) => {
    if (!base) return undefined;
    let committed = false;
    const chunks = [];
    const token = address + CONTENT_TOKEN + version;
    const entry = {
      token,
      prepareData: host.prepareData,
      apply(chunk) {
        if (committed || chunk.type === "data") host.apply(chunk);
        else chunks.push(chunk);
      },
      preview() {
        if (host.preview) for (const chunk of chunks) host.preview(chunk);
      },
      commit() {
        committed = true;
        staged.delete(address);
        for (const chunk of chunks) host.apply(chunk);
      }
    };
    staged.set(address, entry);
    const comp = base[COMPONENT_BINDING].component;
    const binding = props => comp(props, () => token);
    binding[COMPONENT_BINDING] = { component: comp, address: token };
    latest.set(address, binding);
    return entry;
  };
  const settled = (address, binding) => latest.get(address) || binding;
  const showing = address => {
    const frame = host.get(address);
    return frame !== undefined && frame.error === undefined;
  };
  const named = (token, half) => {
    const entry = staged.get(contentAddress(token));
    if (entry && entry.token === token) entry[half]();
  };
  stagedContent.preview = token => named(token, "preview");
  stagedContent.commit = token => named(token, "commit");
  resolveServerComponent = (id, address) => settled(address, bindingFor(address, id));

  const address = frameAddress(ctx.id, ctx.args);
  const binding = bindingFor(address, ctx.id);

  if (response.headers.has(SINGLE_FLIGHT_HEADER)) {
    return applyFlightResponse(response, address, binding);
  }

  calls.set(address, ctx);
  const version = bump(address);
  const entry = showing(address) ? stage(address, binding, version) : undefined;
  if (!entry)
    IS_OBSERVE
      ? host.apply({ type: "start", id: address, version, startedAt: ctx.startedAt })
      : begin(address, version);
  const target = entry || host;
  const applied = applyFrameResponse(response, target, {
    as: address,
    version: frameId => (frameId === address ? version : bump(frameId))
  }).catch(err =>
    target.apply({
      id: address,
      version,
      r: { ":error": { message: String(err && err.message) } }
    })
  );
  return entry ? applied.then(() => settled(address, binding)) : binding;

  async function applyFlightResponse(response, address, binding) {
    const rootId = response.headers.get(FRAME_STREAM_HEADER) ?? "";
    const as = rootId ? address : undefined;
    let feed;
    const source = new ReadableStream({
      start(controller) {
        feed = controller;
      }
    });
    const payload = deserializeStream(new Response(source), flightCodec(getServerFunctionsCodec()));
    let carried = false;

    const regions = new Map();
    const regionOf = id => {
      for (const [root, entry] of regions)
        if (id === root || id.startsWith(root + ".")) return entry;
    };
    const target = {
      apply: chunk => {
        const entry = regionOf(chunk.id);
        if (entry) entry.apply(chunk);
        else host.apply(chunk);
      },
      prepareData: host.prepareData
    };

    await applyFrameResponse(response, target, {
      as,
      version: frameId => {
        const version = bump(frameId);
        let entry = regionOf(frameId);
        if (!entry && showing(frameId)) {
          entry = stage(frameId, frameId === as ? binding : byAddress.get(frameId), version);
          if (entry) regions.set(frameId, entry);
        }
        return version;
      },
      onOutcome: text => {
        carried = true;
        feed.enqueue(createChunk(text));
      }
    });
    feed.close();

    if (!carried) throw new Error("Single-flight frame response carried no outcome");

    const envelope = await payload;
    await deliverFlightData(response, envelope.data);
    if (response.headers.has(ERROR_HEADER) && !hasFlightMetadata(response)) {
      throw envelope.value;
    }
    return rootId ? settled(address, binding) : envelope.value;
  }
}
