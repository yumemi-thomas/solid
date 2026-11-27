// @ts-nocheck
import {
  getOwner,
  runWithOwner,
  createMemo,
  setSwapHook,
  isHidden
} from "solid-js";
import { sharedConfig } from "solid-js/internal";
import { effect } from "./render.js";
import {
  HEAD_ELIGIBLE_TAGS,
  HEAD_ATTR_NAME,
  classifyHeadTag,
  evalHeadProps,
  evalHeadValue,
  headBodyText,
  resourceIdentity,
  replaceableIdentity,
  resolveHead,
  RESOURCE_QUALIFIERS,
  qualifierValue,
  STYLESHEET_FETCH_META
} from "./head.js";
import type { HeadTag, AssetDescriptor, AssetEntry } from "./client.js";

const assetGates = new WeakMap();
export const waitAsset = (promise: Promise<unknown>): void => {
  let gate = assetGates.get(promise);
  if (!gate) {
    runWithOwner(null, () => {
      gate = createMemo(() => promise, { transparent: true });
    });
    assetGates.set(promise, gate);
  }
  gate();
};

const ASSET_REMOVAL_GRACE = 100;
const assetRegistry = new Map();

function assetEntryKey(descriptor) {
  if (descriptor.policy === "exclusive") return "x|" + descriptor.key;
  return descriptor.type === "inline-style"
    ? "i|" + descriptor.id
    : descriptor.type + "|" + descriptor.href;
}

function findAssetElement(selector, attr, value, qualifiers) {
  const nodes = document.querySelectorAll(selector);
  outer: for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].getAttribute(attr) !== value) continue;
    if (!qualifiers) return nodes[i];
    for (let q = 0; q < RESOURCE_QUALIFIERS.length; q++) {
      const name = RESOURCE_QUALIFIERS[q];
      if (
        qualifierValue(name, qualifiers[name]) !== qualifierValue(name, nodes[i].getAttribute(name))
      )
        continue outer;
    }
    return nodes[i];
  }
  return null;
}

function setAssetAttrs(el, attrs) {
  for (const name in attrs) el.setAttribute(name, attrs[name]);
}

function mountAssetElement(descriptor) {
  let el;
  if (descriptor.type === "inline-style") {
    el = findAssetElement("style[data-asset]", "data-asset", descriptor.id);
    if (!el) {
      el = document.createElement("style");
      el.setAttribute("data-asset", descriptor.id);
      el.textContent = descriptor.content || "";
    }
  } else {
    const rel = descriptor.type === "module" ? "modulepreload" : "stylesheet";
    el = findAssetElement(`link[rel="${rel}"]`, "href", descriptor.href);
    if (!el) {
      el = document.createElement("link");
      el.rel = rel;
      el.href = descriptor.href;
    }
  }
  if (descriptor.attrs) setAssetAttrs(el, descriptor.attrs);
  if (!el.isConnected) document.head.appendChild(el);
  return el;
}

const assetLoadSettled = /*#__PURE__*/ Promise.resolve();
function trackAssetLoad(entry, adopted) {
  if (entry.loadPromise) return;
  const el = entry.element;
  let settled = el.sheet != null;
  if (!settled && adopted && typeof performance !== "undefined" && performance.getEntriesByName) {
    settled = performance.getEntriesByName(el.href).length > 0;
  }
  if (settled) {
    entry.loadState = "loaded";
    entry.loadPromise = assetLoadSettled;
    return;
  }
  entry.loadState = "pending";
  entry.loadPromise = new Promise(resolve => {
    const settle = (entry.settle = state => {
      entry.loadState = state;
      resolve();
    });
    el.addEventListener("load", () => settle("loaded"), { once: true });
    el.addEventListener("error", () => settle("errored"), { once: true });
  });
}

export function warmAsset(descriptor: AssetDescriptor): AssetEntry | undefined;
export function warmAsset(descriptor) {
  if (descriptor.policy === "exclusive" || descriptor.type === "inline-style") return;
  const key = assetEntryKey(descriptor);
  let entry = assetRegistry.get(key);
  if (!entry) {
    entry = { count: 0, element: null, timer: null };
    assetRegistry.set(key, entry);
  }
  let adopted = true;
  if (!entry.element || !entry.element.isConnected) {
    const rel = descriptor.type === "module" ? "modulepreload" : "stylesheet";
    let el = findAssetElement(`link[rel="${rel}"]`, "href", descriptor.href);
    if (!el && descriptor.type === "style") {
      el = findAssetElement('link[rel="preload"][as="style"]', "href", descriptor.href);
    }
    if (!el) {
      adopted = false;
      el = document.createElement("link");
      if (descriptor.type === "style") {
        el.setAttribute("rel", "preload");
        el.setAttribute("as", "style");
      } else {
        el.setAttribute("rel", "modulepreload");
      }
      el.setAttribute("href", descriptor.href);
      if (!document.body) el.setAttribute("blocking", "render");
    }
    if (descriptor.attrs) setAssetAttrs(el, descriptor.attrs);
    if (!el.isConnected) document.head.appendChild(el);
    entry.element = el;
    entry.loadState = undefined;
    entry.loadPromise = undefined;
  }
  if (descriptor.type === "style") trackAssetLoad(entry, adopted);
  return entry;
}

export function acquireAsset(descriptor: AssetDescriptor): () => void;
export function acquireAsset(descriptor) {
  const key = assetEntryKey(descriptor);
  let entry = assetRegistry.get(key);
  if (descriptor.policy === "exclusive") {
    if (!entry) {
      entry = { original: descriptor.get(), set: descriptor.set, writers: [] };
      assetRegistry.set(key, entry);
    }
    const writer = { value: descriptor.value };
    entry.writers.push(writer);
    entry.set(writer.value);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const index = entry.writers.indexOf(writer);
      const wasTop = index === entry.writers.length - 1;
      entry.writers.splice(index, 1);
      if (!wasTop) return;
      if (entry.writers.length) {
        entry.set(entry.writers[entry.writers.length - 1].value);
      } else {
        entry.set(entry.original);
        assetRegistry.delete(key);
      }
    };
  }
  if (!entry) {
    entry = { count: 0, element: null, timer: null };
    assetRegistry.set(key, entry);
  }
  if (entry.timer) {
    clearTimeout(entry.timer);
    entry.timer = null;
  }
  entry.count++;
  if (!entry.element || !entry.element.isConnected) {
    entry.element = mountAssetElement(descriptor);
  } else if (descriptor.type === "style" && entry.element.getAttribute("rel") === "preload") {
    entry.element.removeAttribute("as");
    entry.element.setAttribute("rel", "stylesheet");
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--entry.count > 0) return;
    entry.timer = setTimeout(() => {
      assetRegistry.delete(key);
      entry.element && entry.element.remove();
      if (entry.loadState === "pending") entry.settle("errored");
    }, ASSET_REMOVAL_GRACE);
  };
}

let headRegistrations = null;
let headSeq = 0;
let headUid = 0;
let headOwned = null;
let headApplied = null;
let headFallbackTitle = null;
let headScheduled = false;
const headMountedResources = new Set();

function initHeadRegistry() {
  if (headRegistrations) return;
  headRegistrations = [];
  headOwned = new Map();
  headApplied = new Map();
  setSwapHook(scheduleHeadApply);
  const t = document.querySelector("title");
  headFallbackTitle = t
    ? t.hasAttribute("data-dh")
      ? t.getAttribute("data-dhf")
      : t.textContent
    : null;
  if (globalThis._$HY) globalThis._$HY.h = applyServerHeadOps;
}

function applyServerHeadOps(ops) {
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    const identity = op[0] === "t" ? "title" : op[1];
    if (headOwned.has(identity)) continue;
    if (op[0] === "t") setHeadTitle(op[1]);
    else if (op[0] === "r") {
      const els = headMarkedElements(identity);
      for (let j = 0; j < els.length; j++) els[j].remove();
    } else {
      const el = document.createElement(op[2]);
      for (const name in op[3]) el.setAttribute(name, op[3][name]);
      if (op[4] != null) el.textContent = op[4];
      el.setAttribute("data-dh", identity);
      document.head.appendChild(el);
    }
  }
}

function headMarkedElements(identity) {
  const nodes = document.head.querySelectorAll("[data-dh]");
  const out = [];
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].getAttribute("data-dh") === identity) out.push(nodes[i]);
  }
  return out;
}

function setHeadTitle(text) {
  let el = document.querySelector("title");
  if (!el) {
    el = document.createElement("title");
    document.head.appendChild(el);
  }
  el.textContent = text;
  el.setAttribute("data-dh", "title");
  return el;
}

function scheduleHeadApply() {
  if (headScheduled) return;
  headScheduled = true;
  queueMicrotask(flushHeadRegistry);
}

function flushHeadRegistry() {
  if (sharedConfig.hydrating) {
    setTimeout(flushHeadRegistry, 0);
    return;
  }
  headScheduled = false;
  const winners = resolveHead(headRegistrations.filter(r => !isHidden(r.node)));
  for (const [identity, els] of headOwned) {
    if (winners.has(identity)) continue;
    headOwned.delete(identity);
    headApplied.delete(identity);
    if (identity === "title") {
      if (headFallbackTitle != null) {
        const el = setHeadTitle(headFallbackTitle);
        el.removeAttribute("data-dh");
        el.removeAttribute("data-dhf");
      }
    } else {
      for (let i = 0; i < els.length; i++) els[i].remove();
    }
  }
  for (const [identity, winner] of winners) {
    let sig = "";
    for (let i = 0; i < winner.tags.length; i++)
      sig += winner.tags[i].tag + JSON.stringify(winner.tags[i].props) + "|";
    if (headApplied.get(identity) === sig) continue;
    headApplied.set(identity, sig);
    if (identity === "base" || identity === "charset") {
      if ("_SOLID_DEV_")
        console.warn(
          `useHead: <${winner.tags[0].tag}> (${identity}) is shell-only and ignored on the client`
        );
      continue;
    }
    if (identity === "title") {
      const children = winner.tags[0].props.children;
      setHeadTitle(children == null ? "" : String(children));
      headOwned.set(identity, []);
      continue;
    }
    const existing = headMarkedElements(identity);
    const els = [];
    for (let i = 0; i < winner.tags.length; i++) {
      els.push(renderHeadElement(winner.tags[i], identity, existing));
    }
    for (let i = 0; i < existing.length; i++) {
      if (els.indexOf(existing[i]) === -1) existing[i].remove();
    }
    headOwned.set(identity, els);
  }
}

function createHeadElement(tag, props) {
  const el = document.createElement(tag);
  for (const name in props) {
    if (name === "children" || name === "ref" || /^on[A-Z]/.test(name)) continue;
    if (!HEAD_ATTR_NAME.test(name)) {
      if ("_SOLID_DEV_") console.warn(`useHead: ignoring invalid attribute name "${name}"`);
      continue;
    }
    const v = props[name];
    if (v == null || v === false) continue;
    el.setAttribute(name, v === true ? "" : String(v));
  }
  if (props.children != null) el.textContent = headBodyText(tag, props, String(props.children));
  return el;
}

function renderHeadElement(t, identity, existing) {
  for (let i = 0; i < existing.length; i++) {
    if (headElementMatches(existing[i], t)) return existing.splice(i, 1)[0];
  }
  const el = createHeadElement(t.tag, t.props);
  el.setAttribute("data-dh", identity);
  document.head.appendChild(el);
  return el;
}

function headElementMatches(el, t) {
  if (el.tagName.toLowerCase() !== t.tag) return false;
  for (const name in t.props) {
    if (name === "children" || name === "ref" || /^on[A-Z]/.test(name)) continue;
    if (!HEAD_ATTR_NAME.test(name)) continue;
    const v = t.props[name];
    if (v == null || v === false) {
      if (el.hasAttribute(name)) return false;
    } else if (el.getAttribute(name) !== (v === true ? "" : String(v))) return false;
  }
  const children = t.props.children;
  return (
    (children == null ? "" : headBodyText(t.tag, t.props, String(children))) === el.textContent
  );
}

function mountHeadResource(tag, props) {
  const identity = resourceIdentity(tag, props);
  if (headMountedResources.has(identity)) return;
  headMountedResources.add(identity);
  const url = props.href || props.src;
  let el = null;
  if (tag === "link" && url == null && typeof props.imagesrcset === "string")
    el = findAssetElement(`link[rel="${props.rel}"]`, "href", null, props);
  else if (url != null) {
    if (tag === "link") el = findAssetElement(`link[rel="${props.rel}"]`, "href", url, props);
    else if (tag === "script") el = findAssetElement("script[src]", "src", url);
    else el = findAssetElement("style[href]", "href", url);
  }
  if (!el) document.head.appendChild(createHeadElement(tag, props));
}

function gateHeadResource(props) {
  const descriptor = {
    type: props.rel === "stylesheet" ? "style" : "module",
    href: props.href
  };
  let gateable = props.rel === "stylesheet" && props.href != null;
  let attrs = null;
  for (const name in props) {
    if (name === "rel" || name === "href") continue;
    if (!STYLESHEET_FETCH_META.has(name)) gateable = false;
    if (!HEAD_ATTR_NAME.test(name)) continue;
    const v = props[name];
    if (v == null || v === false) continue;
    (attrs || (attrs = {}))[name] = v === true ? "" : String(v);
  }
  if (attrs) descriptor.attrs = attrs;
  effect(
    () => {
      const entry = warmAsset(descriptor);
      const claiming =
        sharedConfig.hydrating && (!sharedConfig.isClaiming || sharedConfig.isClaiming());
      if (
        gateable &&
        !claiming &&
        entry.loadState === "pending" &&
        typeof waitAsset === "function"
      )
        waitAsset(entry.loadPromise);
    },
    () => acquireAsset(descriptor)
  );
}

export function useHead(tag: HeadTag | HeadTag[] | (() => HeadTag | HeadTag[])): void;
export function useHead(tags) {
  initHeadRegistry();
  const reg = { seq: -1, tags: null, node: null };
  const uid = ++headUid;
  effect(
    () => {
      reg.node = getOwner();
      let list = typeof tags === "function" ? tags() : tags;
      if (!Array.isArray(list)) list = [list];
      const replaceable = [];
      const resources = [];
      for (let i = 0; i < list.length; i++) {
        const desc = list[i];
        if (!desc || !HEAD_ELIGIBLE_TAGS.has(desc.tag)) {
          if ("_SOLID_DEV_") console.warn(`useHead: ignoring non-head tag`, desc);
          continue;
        }
        const cls = classifyHeadTag(desc);
        const props = evalHeadProps(
          desc.props || {},
          cls.rel !== undefined ? { rel: cls.rel } : undefined
        );
        if (cls.resource) {
          if (
            desc.tag === "link" &&
            (props.rel === "stylesheet" || props.rel === "modulepreload")
          ) {
            gateHeadResource(props);
          } else if (desc.tag === "link") {
            mountHeadResource(desc.tag, props);
          } else {
            resources.push({ tag: desc.tag, props });
          }
        } else {
          const key = evalHeadValue(desc.key);
          replaceable.push({
            tag: desc.tag,
            props,
            identity: replaceableIdentity(desc.tag, props, key, "u:c" + uid + ":" + i)
          });
        }
      }
      return { replaceable, resources };
    },
    evaluated => {
      for (let i = 0; i < evaluated.resources.length; i++) {
        mountHeadResource(evaluated.resources[i].tag, evaluated.resources[i].props);
      }
      reg.tags = evaluated.replaceable;
      if (reg.seq < 0) reg.seq = ++headSeq;
      if (headRegistrations.indexOf(reg) === -1) headRegistrations.push(reg);
      scheduleHeadApply();
      return () => {
        const idx = headRegistrations.indexOf(reg);
        if (idx > -1) headRegistrations.splice(idx, 1);
        scheduleHeadApply();
      };
    }
  );
}
