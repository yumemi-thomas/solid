// @ts-nocheck
import { ChildProperties, Namespaces, DelegatedEvents, DOMWithState } from "./constants.js";
import { getOwner, $PROXY } from "solid-js";
import {
  heldRead,
  viewOf,
  OmitView,
  sourceKeys,
  sourceHas,
  sourceGet,
  hasStaticKeys,
  resolvedTable,
  SOURCE_PLAIN,
  SOURCE_OMIT,
  SOURCE_PROXY,
  SOURCE_MEMO
} from "solid-js/internal";
import { effect, setSpreadName, spreadLoc, spreadName, tagElement } from "./render.js";
import { checkStatefulWrite, recordStatefulWrite } from "./diagnostics.js";
import {
  addEvent,
  claimElement,
  className,
  delegateEvents,
  insert,
  readShallow,
  ref,
  setAttribute,
  setAttributeNS,
  style,
  _$$EVENT_TUPLE,
  _hasClaimHandlers,
  _insertExpression,
  _isHydrating,
  _normalize,
  _reclaimAttribute,
  _setUnscopedByDesign,
  _writeSelectValue
} from "./client.js";

export function spread(
  node: Element,
  sources: unknown[],
  skipChildren?: Boolean,
  skip?: (key: string) => boolean,
  name?: string,
  loc?: string
): void;
export function spread<T>(
  node: Element,
  accessor: T,
  skipChildren?: Boolean,
  skip?: (key: string) => boolean,
  name?: string,
  loc?: string
): void;
export function spread(node, props, skipChildren, skip, name, loc) {
  if ("_SOLID_OBSERVE_" && name !== undefined) {
    const outer = spreadName;
    const outerLoc = spreadLoc;
    setSpreadName(name, loc);
    try {
      return spread(node, props, skipChildren, skip);
    } finally {
      setSpreadName(outer, outerLoc);
    }
  }
  const prevProps = {};
  const owner =
    _hasClaimHandlers() && (node.localName === "a" || node.localName === "form")
      ? getOwner()
      : undefined;
  let held = 0;
  const apply = newProps => {
    const r = newProps.ref;
    if (r !== prevProps.ref && (typeof r === "function" || Array.isArray(r))) ref(() => r, node);
    spreadHeld = held;
    assign(node, newProps, true, prevProps, true);
    spreadHeld = 0;
    if (owner !== undefined) claimElement(node, owner);
  };
  const read = fn => () => {
    const p = fn();
    held = heldRead();
    return p;
  };
  if (Array.isArray(props)) {
    effect(
      read(() => collectSources({}, props, undefined, skip)),
      apply
    );
    if ("_SOLID_DEV_") _setUnscopedByDesign(node);
    if (!skipChildren && !(skip !== undefined && skip("children")))
      insert(node, () => {
        for (let i = props.length - 1; i >= 0; i--) {
          const s = resolveSource(props[i]);
          if (s && entryHas(s, "children")) return entryGet(s, "children");
        }
      });
    if ("_SOLID_DEV_") _setUnscopedByDesign(null);
    return prevProps;
  }
  const collect = () => {
    const source = resolveSource(props);
    const newProps = {};
    const table = resolvedTable(source);
    if (table !== undefined) return collectTable(newProps, table, skip);
    if (source) {
      const view = viewOf(source);
      if (view instanceof OmitView) collectProps(newProps, view, SOURCE_OMIT, skip);
      else if (view !== undefined) collectSources(newProps, view.sources, view.kinds, skip);
      else collectProps(newProps, source, $PROXY in source ? SOURCE_PROXY : SOURCE_PLAIN, skip);
    }
    return newProps;
  };
  effect(read(collect), apply);
  if ("_SOLID_DEV_") _setUnscopedByDesign(node);
  if (!skipChildren && !(skip !== undefined && skip("children"))) {
    if (typeof props !== "function" && props != null && hasStaticKeys(props)) {
      const desc = Object.getOwnPropertyDescriptor(props, "children");
      if (desc !== undefined) {
        if (desc.get === undefined) insert(node, desc.value);
        else insert(node, () => props.children);
      }
    } else
      insert(node, () => {
        const source = resolveSource(props);
        return source && entryHas(source, "children") ? entryGet(source, "children") : undefined;
      });
  }
  if ("_SOLID_DEV_") _setUnscopedByDesign(null);
  return prevProps;
}

function collectTable(out, table, skip) {
  for (const [prop, leaf] of table) {
    if (typeof prop !== "string" || prop === "children") continue;
    if (skip !== undefined && skip(prop)) continue;
    const v = leaf[prop];
    out[prop] = prop === "style" || prop === "class" ? readShallow(v) : v;
  }
  return out;
}

function resolveSource(s) {
  return typeof s === "function" ? s() : s;
}

function entryHas(s, key) {
  const view = viewOf(s);
  return view instanceof OmitView ? sourceHas(view, SOURCE_OMIT, key) : key in s;
}
function entryGet(s, key) {
  const view = viewOf(s);
  return view instanceof OmitView ? sourceGet(view, SOURCE_OMIT, key) : s[key];
}

function collectSources(out, sources, kinds, skip) {
  const resolved = [];
  const resolvedKinds = [];
  for (let i = 0; i < sources.length; i++)
    pushEntry(resolved, resolvedKinds, sources[i], kinds !== undefined ? kinds[i] : SOURCE_MEMO);
  for (let i = 0; i < resolved.length; i++)
    collectProps(out, resolved[i], resolvedKinds[i], skip, resolved, resolvedKinds, i + 1);
  return out;
}

function pushEntry(resolved, kinds, s, kind) {
  if (kind !== SOURCE_MEMO) {
    resolved.push(s);
    kinds.push(kind);
    return;
  }
  s = resolveSource(s);
  if (!s) return;
  const view = viewOf(s);
  if (view instanceof OmitView) {
    resolved.push(view);
    kinds.push(SOURCE_OMIT);
  } else if (view !== undefined) {
    const f = view.sources,
      k = view.kinds;
    for (let j = 0; j < f.length; j++) pushEntry(resolved, kinds, f[j], k[j]);
  } else {
    resolved.push(s);
    kinds.push($PROXY in s ? SOURCE_PROXY : SOURCE_PLAIN);
  }
}

function collectProps(out, s, kind, skip, later?, laterKinds?, from?) {
  const keys = sourceKeys(s, kind);
  outer: for (let i = 0; i < keys.length; i++) {
    const prop = keys[i];
    if (typeof prop !== "string" || prop === "children") continue;
    if (skip !== undefined && skip(prop)) continue;
    if (later !== undefined)
      for (let j = from; j < later.length; j++)
        if (sourceHas(later[j], laterKinds[j], prop)) continue outer;
    const v = sourceGet(s, kind, prop);
    out[prop] = prop === "style" || prop === "class" ? readShallow(v) : v;
  }
}

export function assign(
  node: Element,
  props: any,
  skipChildren?: Boolean,
  prevProps?: any,
  skipRef?: Boolean
): void;
export function assign(node, props, skipChildren, prevProps = {}, skipRef = false) {
  if ("_SOLID_DEV_") tagElement(node);
  const nodeName = node.nodeName;
  props || (props = {});
  for (const prop in prevProps) {
    if (!(prop in props)) {
      if (prop === "children") continue;
      prevProps[prop] = assignProp(node, prop, null, prevProps[prop], skipRef, nodeName);
    }
  }
  for (const prop in props) {
    if (prop === "children") {
      if (!skipChildren) _insertExpression(node, _normalize(props.children, undefined, false));
      continue;
    }
    prevProps[prop] = assignProp(node, prop, props[prop], prevProps[prop], skipRef, nodeName);
  }
}

let spreadHeld = 0;
function assignProp(node, prop, value, prev, skipRef, nodeName) {
  if (prop === "style") return (style(node, value, prev), value);
  if (prop === "class") return (className(node, value, prev), value);
  if (value === prev && (spreadHeld || DOMWithState[nodeName]?.[prop] !== 1)) return prev;
  if (prop === "ref") {
    if (!skipRef && value) ref(() => value, node);
    return value;
  }

  let c;
  const hasNamespace = prop.indexOf(":") > -1;

  if (!hasNamespace && prop.startsWith("on") && (c = prop.charCodeAt(2)) > 64 && c < 91) {
    const name = prop.slice(2).toLowerCase();
    const delegate = DelegatedEvents.has(name);
    if (!delegate && prev) {
      if (Array.isArray(value) && typeof prev === "function" && prev[_$$EVENT_TUPLE] === value)
        return prev;
      node.removeEventListener(name, prev, typeof prev !== "function" && prev);
    }
    if (delegate || value) {
      const attached = addEvent(node, name, value, delegate);
      delegate && delegateEvents([name]);
      if (!delegate) return attached;
    }
  } else if (
    (hasNamespace && prop.slice(0, 5) === "prop:") ||
    ChildProperties.has(prop) ||
    DOMWithState[nodeName]?.[prop]
  ) {
    if (hasNamespace) prop = prop.slice(5);
    else if (_isHydrating(node)) return value;
    if ("_SOLID_DEV_") checkStatefulWrite(node, prop, value);
    if (prop === "value" && nodeName === "SELECT") _writeSelectValue(node, value);
    else if (
      (prop === "value" || prop === "defaultValue") &&
      (nodeName === "INPUT" || nodeName === "TEXTAREA")
    ) {
      if (value == null && /^(checkbox|radio)$/.test(node.type)) node.removeAttribute("value");
      else node[prop] = value ?? "";
    } else node[prop] = value;
    if ("_SOLID_DEV_") recordStatefulWrite(node, prop, value);
    _reclaimAttribute(node, prop);
  } else {
    const ns = hasNamespace && Namespaces[prop.split(":")[0]];
    if (ns) setAttributeNS(node, ns, prop, value);
    else setAttribute(node, prop, value);
  }
  return value;
}
