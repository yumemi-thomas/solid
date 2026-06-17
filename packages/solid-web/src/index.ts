import {
  getNextElement,
  // `insert`/`spread` are used internally here (Repeat/Portal/spread paths) and
  // are also re-exported to the compiler via the `export * from "./client.js"`
  // below. They no longer carry view-transition instrumentation — update
  // detection is geometry-driven (see `snapshotViewTransitionRects`).
  insert,
  spread,
  SVGElements,
  MathMLElements,
  Namespaces,
  render as renderCore,
  hydrate as hydrateCore,
  registerDelegatedContainer,
  unregisterDelegatedContainer,
  getDelegatedRoot
} from "./client.js";
import {
  createComponent,
  children,
  createContext,
  createMemo,
  createRoot,
  getOwner,
  onCleanup,
  runWithOwner,
  untrack,
  omit,
  sharedConfig,
  enableHydration,
  enforceLoadingBoundary,
  flush,
  setTransitionCommitWrapper,
  setCommitGate,
  onTransitionInit,
  pauseEffects,
  startGestureTransaction as startSolidGestureTransaction,
  $DEVCOMP,
  Component,
  createEffect,
  createRenderEffect,
  useContext,
  LoadingRevealedContext,
  type Accessor,
  type Owner
} from "solid-js";
import type { JSX } from "./jsx.js";

export * from "./client.js";
export * from "./server-mock.js";
export type { JSX } from "./jsx.js";
export {
  For,
  Show,
  Switch,
  Match,
  Errored,
  Loading,
  Repeat,
  Reveal,
  NoHydration,
  Hydration
} from "solid-js";

import { merge } from "solid-js";

/**
 * Compiler-emitted prop-spread helper. The JSX transform (in
 * `dom-expressions`) emits `mergeProps(...)` calls when compiling prop
 * spreads on components — it is *not* a user-facing API. Application code
 * should import `merge` from `solid-js` directly.
 *
 * @internal
 */
export const mergeProps = merge;

// The compiler-emitted DOM helpers (`insert`, `spread`, `setProperty`,
// `setAttribute`, `className`, `style`, …) are re-exported unmodified from
// `./client.js` via the `export *` above. They used to be wrapped here to feed
// `<ViewTransition>` update detection off every DOM write; update detection is
// now geometry-driven (measured around a transition's flush — see
// `snapshotViewTransitionRects`/`fireViewTransitionUpdates`), matching React, so
// no per-write instrumentation is needed and the wrappers are gone.

type ActivityMode = "hidden" | "visible" | null | undefined;
type ActivityHidden = Accessor<boolean>;
type StyleElement = Element & { style: CSSStyleDeclaration };
const ActivityContext = createContext<ActivityHidden>(() => false);
const activityHiddenCounts = new WeakMap<
  StyleElement,
  {
    count: number;
    display: string;
  }
>();

function isStyleElement(value: unknown): value is StyleElement {
  return value instanceof Element && "style" in value;
}

function collectElements(value: unknown, result: StyleElement[] = []) {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) collectElements(value[i], result);
  } else if (isStyleElement(value)) {
    result.push(value);
  }
  return result;
}

function hideElement(el: StyleElement) {
  const record = activityHiddenCounts.get(el);
  if (record) {
    record.count++;
    return () => {
      if (--record.count === 0) {
        el.style.display = record.display;
        activityHiddenCounts.delete(el);
      }
    };
  }

  const display = el.style.display;
  activityHiddenCounts.set(el, { count: 1, display });
  el.style.display = "none";
  return () => {
    const current = activityHiddenCounts.get(el);
    if (!current) return;
    if (--current.count === 0) {
      el.style.display = current.display;
      activityHiddenCounts.delete(el);
    }
  };
}

function applyActivityHidden(value: unknown, hidden: boolean) {
  if (!hidden) return;
  const disposers = collectElements(value).map(hideElement);
  return () => {
    for (let i = disposers.length - 1; i >= 0; i--) disposers[i]();
  };
}

function collectNodesBetween(start: Node, end: Node) {
  const nodes: Node[] = [];
  let node = start.nextSibling;
  while (node && node !== end) {
    nodes.push(node);
    node = node.nextSibling;
  }
  return nodes;
}

function applyPortalActivityHidden(start: Node, end: Node, hidden: boolean) {
  if (!hidden) return;
  let cleanup = applyActivityHidden(collectNodesBetween(start, end), true);
  const parent = end.parentNode;
  const observer =
    parent && typeof MutationObserver === "function"
      ? new MutationObserver(() => {
          cleanup?.();
          cleanup = applyActivityHidden(collectNodesBetween(start, end), true);
        })
      : undefined;

  observer?.observe(parent!, { childList: true, subtree: true });

  return () => {
    observer?.disconnect();
    cleanup?.();
  };
}

function ActivityContent(props: { hidden: ActivityHidden; children: JSX.Element }) {
  const resolved = children(() => props.children);
  // The owner whose subtree holds the children's user effects (`createEffect`).
  // React parity: while hidden, those effects are paused — their cleanups run
  // and their bodies stop, resuming (re-running) on show — so timers and
  // subscriptions don't keep firing behind a hidden pane. State, signals, and
  // DOM are untouched (render effects are NOT paused, so the hidden DOM stays
  // current — a deliberate, safer divergence from React's defer-while-hidden).
  const owner = getOwner();

  createRenderEffect(
    () => [props.hidden(), resolved.toArray()] as const,
    ([hidden, nodes]) => {
      const undoHide = applyActivityHidden(nodes, hidden);
      const resume = hidden && owner ? pauseEffects(owner) : undefined;
      if (undoHide || resume)
        return () => {
          undoHide?.();
          resume?.();
        };
    },
    { schedule: true }
  );

  return resolved as unknown as JSX.Element;
}

/**
 * Keeps a subtree mounted while optionally hiding its rendered DOM.
 *
 * `mode="hidden"` applies `display: none` to the subtree's top-level DOM
 * elements and to portal content rendered by descendants. `mode="visible"`
 * (the default) leaves content visible unless an outer Activity is hidden.
 */
export function Activity(props: { mode?: ActivityMode; name?: string; children?: JSX.Element }) {
  if (isDev && (props as { hidden?: unknown }).hidden !== undefined) {
    const hidden = (props as { hidden?: unknown }).hidden;
    console.error(
      `<Activity> doesn't accept a hidden prop. Use mode="hidden" instead.\n- <Activity ${
        hidden === true ? "hidden" : hidden === false ? "hidden={false}" : "hidden={...}"
      }>\n+ <Activity ${hidden ? 'mode="hidden"' : 'mode="visible"'}>`
    );
  }
  const parentHidden = useContext(ActivityContext);
  const hidden = createMemo(() => parentHidden() || props.mode === "hidden", { sync: true });

  return createComponent(ActivityContext, {
    value: hidden,
    get children() {
      return createComponent(ActivityContent, {
        hidden,
        get children() {
          return props.children;
        }
      });
    }
  }) as JSX.Element;
}

export type ViewTransitionClass =
  | "none"
  | "auto"
  | (string & {})
  | {
      default?: "none" | "auto" | (string & {});
      [type: string]: "none" | "auto" | (string & {}) | undefined;
    };

export type ViewTransitionPseudoElement = {
  animate(
    keyframes: Keyframe[] | PropertyIndexedKeyframes | null,
    options?: number | KeyframeAnimationOptions
  ): Animation;
  getAnimations(options?: GetAnimationsOptions): Animation[];
  getComputedStyle(): CSSStyleDeclaration;
};

export type ViewTransitionInstance = {
  name: string;
  nodes: Element[];
  group: ViewTransitionPseudoElement;
  imagePair: ViewTransitionPseudoElement;
  old: ViewTransitionPseudoElement;
  new: ViewTransitionPseudoElement;
};

export type GestureOptions = {
  rangeStart?: number;
  rangeEnd?: number;
};
export type GestureOptionsRequired = {
  rangeStart: number;
  rangeEnd: number;
};
export type GestureProvider =
  | AnimationTimeline
  | {
      currentTime?: CSSNumberish | null;
      animate?: (animation: Animation, options: GestureOptionsRequired) => void | (() => void);
    };
export type ViewTransitionScopeOptions = {
  types?: string[];
  gesture?: {
    timeline: GestureProvider;
    options?: GestureOptions;
  };
};
export type ViewTransitionScope<T = void> = {
  ready: Promise<void>;
  finished: Promise<void>;
  updateCallbackDone: Promise<void>;
  result: Promise<Awaited<T>>;
  skipTransition(): void;
};
export type GestureViewTransitionScope<T = void> = ViewTransitionScope<T> & {
  commitGesture(): void;
  cancelGesture(): void;
  finishGesture(): void;
};

type ViewTransitionCallback = (
  instance: ViewTransitionInstance,
  types: string[]
) => void | (() => void);
type ViewTransitionGestureCallback = (
  timeline: GestureProvider,
  options: GestureOptionsRequired,
  instance: ViewTransitionInstance,
  types: string[]
) => void | (() => void);

export type ViewTransitionProps = {
  name?: string;
  children?: JSX.Element;
  default?: ViewTransitionClass;
  enter?: ViewTransitionClass;
  exit?: ViewTransitionClass;
  share?: ViewTransitionClass;
  update?: ViewTransitionClass;
  onEnter?: ViewTransitionCallback;
  onExit?: ViewTransitionCallback;
  onShare?: ViewTransitionCallback;
  onUpdate?: ViewTransitionCallback;
  onGestureEnter?: ViewTransitionGestureCallback;
  onGestureExit?: ViewTransitionGestureCallback;
  onGestureShare?: ViewTransitionGestureCallback;
  onGestureUpdate?: ViewTransitionGestureCallback;
};

let viewTransitionId = 0;
let viewTransitionInternalMutation = false;
let pendingTransitionTypes: string[] | null = null;
// Automatic view transitions only. Types declared via `addTransitionType` are
// buffered here (NOT cleared on a microtask, unlike `pendingTransitionTypes`)
// and captured onto the transition object via the scheduler's `onTransitionInit`
// hook, so they survive to an async auto-commit. Read back in the commit wrapper.
let pendingAutoTransitionTypes: string[] | null = null;
const autoTransitionTypes = new WeakMap<object, string[]>();
let autoWrapperInstalled = false;
let pendingGesture:
  | {
      timeline: GestureProvider;
      options: GestureOptionsRequired;
    }
  | undefined;
type BrowserViewTransition = {
  ready?: PromiseLike<unknown>;
  finished?: PromiseLike<unknown>;
  updateCallbackDone?: PromiseLike<unknown>;
  types?: {
    add?: (type: string) => unknown;
  };
  skipTransition?: () => void;
};
let activeViewTransition: BrowserViewTransition | undefined;
// The in-flight browser view transition's `finished` promise (null when none is
// animating). The scheduler's commit gate (`setCommitGate`) reads this: while a
// transition is animating, an auto commit WAITS for it to finish instead of
// starting a second one that would abort it (browsers run one at a time). Writes
// during the wait coalesce, so the next transition animates toward the latest
// state — React's "wait, then commit the latest" behavior rather than abort.
let activeBrowserVTFinished: Promise<unknown> | null = null;
// Gate the scheduler consults before an auto commit (installed while a
// <ViewTransition> boundary is mounted). Returning the active `finished` promise
// defers the commit until that animation completes. Manual `startViewTransition`
// is unaffected (it's the explicit escape hatch and still supersedes).
const autoCommitGate = (): PromiseLike<unknown> | null =>
  // Don't gate a commit that is itself running inside a view transition's update
  // callback (manual `startViewTransition`, or the auto wrapper re-entering via
  // its own flush): that commit IS part of the active transition, not a new one
  // competing with it. Only a fresh commit arriving while a previous transition
  // animates in the background (no active update callback) should wait.
  activeViewTransition ? null : activeBrowserVTFinished;
type ViewTransitionBoundaryState = {
  latest?: ViewTransitionInstance;
  props: ViewTransitionProps;
  updateInFlight: boolean;
  disposed: boolean;
  // Per-host bounding rects snapshotted before a transition's flush; compared
  // after the flush to decide whether the boundary geometry changed (and thus
  // whether to fire `update`). Cleared once consumed.
  updateSnapshot?: (DOMRect | ClientRect)[];
};
const mountedNamedViewTransitions = new Map<string, object>();
// Every live `<ViewTransition>` boundary, iterated to measure geometry around a
// transition's flush. Replaces the per-node WeakMap + mutation monkey-patching
// that previously drove update detection.
const mountedViewTransitionBoundaries = new Set<ViewTransitionBoundaryState>();
const gestureProviderStates = new WeakMap<
  object,
  {
    count: number;
    transaction?: ReturnType<typeof startSolidGestureTransaction>;
  }
>();

// Gesture lifecycle, consumed by `UnstableKeepAlive` so it can retain a branch for
// the duration of a gesture and dispose it once the gesture settles. Module-level,
// like `pendingGesture` / `gestureProviderStates` above. `activeGestureCount` is a
// ref-count over in-flight gesture handles (commit/cancel/finish each release one).
let activeGestureCount = 0;
const gestureSettleListeners = new Set<(committed: boolean) => void>();

function isGestureActive(): boolean {
  return activeGestureCount > 0;
}

function onGestureSettle(listener: (committed: boolean) => void): () => void {
  gestureSettleListeners.add(listener);
  return () => {
    gestureSettleListeners.delete(listener);
  };
}

function notifyGestureSettle(committed: boolean): void {
  // Only when the last in-flight gesture has finalized — so listeners see the final
  // committed/cancelled DOM, not an intermediate concurrent state.
  if (activeGestureCount !== 0 || !gestureSettleListeners.size) return;
  const listeners = [...gestureSettleListeners];
  for (let i = 0; i < listeners.length; i++) {
    try {
      listeners[i](committed);
    } catch (error) {}
  }
}

type ExitRecord = {
  name: string;
  instance: ViewTransitionInstance;
  props: ViewTransitionProps;
  elements: readonly Node[];
  cancelled: boolean;
  // Transition scope captured at unmount; `undefined` when the boundary was
  // removed outside a transition, in which case the exit does not animate.
  context?: ViewTransitionContext;
};
const pendingViewTransitionExits = new Map<string, ExitRecord>();
// Exits departing in the current flush, resolved together one microtask later so
// nested same-name shares (matched on the appearing side) and ancestor/descendant
// relationships are all known before any callback fires. Mirrors React resolving
// the whole commit's pairings before scheduling view-transition events.
const exitBatch: ExitRecord[] = [];
let exitBatchScheduled = false;

function flushExitBatch() {
  exitBatchScheduled = false;
  const batch = exitBatch.splice(0);
  for (const record of batch) {
    if (pendingViewTransitionExits.get(record.name) === record)
      pendingViewTransitionExits.delete(record.name);
    // A same-name mount paired this departure as a share — it already fired.
    if (record.cancelled) continue;
    // React parity: when an ancestor ViewTransition is also exiting in this flush
    // it subsumes this one — only the outermost exit fires onExit. (React matches
    // nested *shares* individually but fires no onExit for nested unmatched
    // boundaries; their animation rides under the ancestor's exit.)
    const subsumed = batch.some(
      other =>
        other !== record &&
        !other.cancelled &&
        other.elements.some(ancestor =>
          record.elements.some(node => ancestor !== node && ancestor.contains(node))
        )
    );
    if (subsumed) continue;
    // React parity: an unmount outside a transition does not animate.
    if (!record.context) continue;
    runViewTransitionEvent(
      "exit",
      record.instance,
      record.props,
      record.props.onExit,
      record.props.onGestureExit,
      record.context
    );
  }
}
// Named elements that mounted during the current flush and are waiting one
// microtask to decide enter-vs-share. A same-name element departing later in
// the same flush claims `departing`, turning the pending enter into a share.
// This mirrors React, which commits the appearing ViewTransition before the
// departing one and resolves the pair synchronously in the mutation phase
// (the appearing element is tracked first, deletions are matched against it).
type AppearingViewTransition = {
  // Transition scope captured when the same-name element mounted. `undefined`
  // means the mount happened outside a transition (no enter animation).
  context?: ViewTransitionContext;
  departing?: {
    instance: ViewTransitionInstance;
    props: ViewTransitionProps;
    // Transition scope captured at the departing element's unmount.
    context?: ViewTransitionContext;
  };
};
const appearingViewTransitions = new Map<string, AppearingViewTransition>();
// Count of currently-mounted boundaries per name. Read synchronously when a
// boundary mounts: a non-zero count means a same-name element is still live and
// about to depart (a replacement), so we defer the enter/share decision to pair
// with it. A fresh mount (count 0) fires enter synchronously — no deferral, so
// no timing change for the common case.
const liveViewTransitionNames = new Map<string, number>();

// React parity (`hasInstanceChanged` in react-dom-bindings ReactFiberConfigDOM.js,
// minus the clip short-circuit — React's own comment notes it "doesn't actually
// have any effect yet until browsers implement layered capture and nested view
// transitions"): a boundary's geometry changed if any host element's x/y/width/
// height differs. A structural change (different element count) always counts.
function viewTransitionGeometryChanged(
  before: (DOMRect | ClientRect)[],
  nodes: readonly Element[]
): boolean {
  if (before.length !== nodes.length) return true;
  for (let i = 0; i < nodes.length; i++) {
    const oldRect = before[i];
    const node = nodes[i];
    if (typeof (node as Element).getBoundingClientRect !== "function") continue;
    const newRect = node.getBoundingClientRect();
    if (
      oldRect.x !== newRect.x ||
      oldRect.y !== newRect.y ||
      oldRect.width !== newRect.width ||
      oldRect.height !== newRect.height
    )
      return true;
  }
  return false;
}

// A boundary is "not rendered" (display:none, an unrendered ancestor, or
// detached) when every host element has a zero-area box. An off-screen-but-
// rendered element still has real width/height, so this reliably distinguishes
// "hidden" from "scrolled out of view" — used to route an `<Activity>` reveal/
// hide to enter/exit rather than update (React fires enter/exit on an Activity
// visibility flip, not update).
function isZeroAreaRect(rect: DOMRect | ClientRect): boolean {
  return rect.width === 0 && rect.height === 0;
}
function allZeroArea(rects: readonly (DOMRect | ClientRect)[]): boolean {
  if (!rects.length) return false;
  for (let i = 0; i < rects.length; i++) if (!isZeroAreaRect(rects[i])) return false;
  return true;
}
function boundaryHidden(nodes: readonly Element[]): boolean {
  if (!nodes.length) return false;
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (typeof node.getBoundingClientRect !== "function") return false;
    if (!isZeroAreaRect(node.getBoundingClientRect())) return false;
  }
  return true;
}

// Snapshot every live boundary's host-element rects just before a transition's
// flush mutates the DOM. Called from `startViewTransition`'s update callback
// while the live DOM is still the "old" state (the browser has already captured
// its old visual snapshot). Mirrors React measuring staying ViewTransitions in
// the before-mutation commit phase.
function snapshotViewTransitionRects() {
  for (const state of mountedViewTransitionBoundaries) {
    if (state.disposed || !state.latest) {
      state.updateSnapshot = undefined;
      continue;
    }
    state.updateSnapshot = state.latest.nodes.map(node =>
      typeof (node as Element).getBoundingClientRect === "function"
        ? node.getBoundingClientRect()
        : new DOMRect()
    );
  }
}

// After the flush, re-measure each snapshotted boundary and fire `update` for
// those whose geometry changed — the geometry-driven analog of React's
// measure-phase update. Runs while `activeViewTransition` is still set, so the
// context (including gesture/types) is the live one.
function fireViewTransitionUpdates() {
  const context = captureViewTransitionContext();
  for (const state of mountedViewTransitionBoundaries) {
    const before = state.updateSnapshot;
    state.updateSnapshot = undefined;
    if (!before || !context || state.disposed || state.updateInFlight || !state.latest) continue;
    const nodes = state.latest.nodes as Element[];
    // React parity: an `<Activity>` revealing (hidden→visible) or hiding
    // (visible→hidden) a STAYING boundary fires enter/exit, not update —
    // React drives Activity visibility flips through enter/exit, reserving
    // update for in-place geometry changes. We detect the flip from the box
    // going zero-area↔non-zero (newly mounted/unmounted boundaries are handled
    // by the render-effect/cleanup paths and never reach here).
    const wasHidden = allZeroArea(before);
    const nowHidden = boundaryHidden(nodes);
    let kind: "enter" | "exit" | "update";
    let callback: ViewTransitionCallback | undefined;
    let gestureCallback: ViewTransitionGestureCallback | undefined;
    if (wasHidden && !nowHidden) {
      kind = "enter";
      callback = state.props.onEnter;
      gestureCallback = state.props.onGestureEnter;
    } else if (!wasHidden && nowHidden) {
      kind = "exit";
      callback = state.props.onExit;
      gestureCallback = state.props.onGestureExit;
    } else if (!wasHidden && !nowHidden && viewTransitionGeometryChanged(before, nodes)) {
      kind = "update";
      callback = state.props.onUpdate;
      gestureCallback = state.props.onGestureUpdate;
    } else {
      continue; // stayed hidden, or no geometry change
    }
    state.updateInFlight = true;
    const done = runViewTransitionEvent(
      kind,
      state.latest,
      state.props,
      callback,
      gestureCallback,
      context
    );
    const release = () => (state.updateInFlight = false);
    Promise.resolve(done).then(release, release);
  }
}

function getViewTransitionClass(element: StyleElement) {
  return ((element.style as CSSStyleDeclaration & { viewTransitionClass?: string })
    .viewTransitionClass ?? "") as string;
}

function setViewTransitionClass(element: StyleElement, value: string) {
  (element.style as CSSStyleDeclaration & { viewTransitionClass?: string }).viewTransitionClass =
    value;
}

function encodeViewTransitionName(name: string) {
  if (/^-?[_a-zA-Z][-_a-zA-Z0-9]*$/.test(name)) return name;
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function" && CSS.escape(name) === name) {
    return name;
  }
  if (typeof btoa === "function") {
    try {
      return `solid-${btoa(name).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")}`;
    } catch (error) {}
  }
  let encoded = "";
  for (let i = 0; i < name.length; i++) encoded += name.charCodeAt(i).toString(16);
  return `solid-${encoded}`;
}

function createViewTransitionPseudoElement(
  name: string,
  pseudo: "group" | "image-pair" | "old" | "new"
): ViewTransitionPseudoElement {
  const pseudoElement = `::view-transition-${pseudo}(${name})`;
  return {
    animate(keyframes, options) {
      const element = document.documentElement;
      const animationOptions =
        typeof options === "number"
          ? { duration: options, pseudoElement }
          : { ...(options ?? {}), pseudoElement };
      return element.animate(keyframes, animationOptions as KeyframeAnimationOptions);
    },
    getAnimations(options) {
      const animations = document.documentElement.getAnimations(options);
      return animations.filter(animation => {
        const effect = animation.effect;
        return (
          effect != null &&
          "pseudoElement" in effect &&
          effect.pseudoElement != null &&
          effect.pseudoElement === pseudoElement
        );
      });
    },
    getComputedStyle() {
      try {
        return getComputedStyle(document.documentElement, pseudoElement);
      } catch (error) {
        return getComputedStyle(document.documentElement);
      }
    }
  };
}

function createViewTransitionInstance(name: string, nodes: Element[]): ViewTransitionInstance {
  const pseudoName = encodeViewTransitionName(name);
  return {
    name,
    nodes,
    group: createViewTransitionPseudoElement(pseudoName, "group"),
    imagePair: createViewTransitionPseudoElement(pseudoName, "image-pair"),
    old: createViewTransitionPseudoElement(pseudoName, "old"),
    new: createViewTransitionPseudoElement(pseudoName, "new")
  };
}

// Ported from React's ReactFiberConfigDOM `mergeTranslate`: additively combines
// two `translate` values so we can nudge a pseudo-element back into the viewport
// without clobbering an existing translate.
function mergeGestureTranslate(
  translateA: string | null | undefined,
  translateB: string | null | undefined
): string {
  if (!translateA || translateA === "none") return translateB || "";
  if (!translateB || translateB === "none") return translateA || "";
  const partsA = translateA.split(" ");
  const partsB = translateB.split(" ");
  let i = 0;
  let result = "";
  for (; i < partsA.length && i < partsB.length; i++) {
    if (i > 0) result += " ";
    result += "calc(" + partsA[i] + " + " + partsB[i] + ")";
  }
  for (; i < partsA.length; i++) result += " " + partsA[i];
  for (; i < partsB.length; i++) result += " " + partsB[i];
  return result;
}

// Ported from React's `moveOldFrameIntoViewport`: an "old" snapshot animating
// from its committed position starts outside the viewport, so we offset the
// first keyframe back in.
function moveOldGestureFrameIntoViewport(keyframe: any): void {
  const computedTransform: string | undefined = keyframe.transform;
  if (computedTransform != null) {
    let transform = computedTransform === "none" ? "" : computedTransform;
    transform = "translate(20000px, 20000px) " + transform;
    keyframe.transform = transform;
  }
}

function isViewTransitionGestureEffect(effect: AnimationEffect | null): effect is KeyframeEffect {
  return (
    !!effect &&
    "pseudoElement" in effect &&
    typeof (effect as KeyframeEffect).pseudoElement === "string" &&
    (effect as KeyframeEffect).pseudoElement!.startsWith("::view-transition")
  );
}

// Ported from React's `animateGesture`: recreates one view-transition pseudo
// animation bound to the gesture timeline. Mutating the existing animation's
// range/timeline is unreliable across browsers (React notes the same), so we
// cancel + recreate with linear easing, a mapped range, and reversed direction.
function animateGestureAnimation(
  keyframes: any[],
  targetElement: Element,
  pseudoElement: string,
  timeline: AnimationTimeline,
  startedAnimations: Animation[],
  rangeStart: number,
  rangeEnd: number,
  moveFirstFrameIntoViewport: boolean,
  moveAllFramesIntoViewport: boolean
): void {
  let width: unknown;
  let height: unknown;
  let unchangedDimensions = true;
  for (let i = 0; i < keyframes.length; i++) {
    const keyframe = keyframes[i];
    // Gestures always use linear easing for direct scrub control.
    delete keyframe.easing;
    delete keyframe.computedOffset;
    const w = keyframe.width;
    if (width === undefined) width = w;
    else if (width !== w) unchangedDimensions = false;
    const h = keyframe.height;
    if (height === undefined) height = h;
    else if (height !== h) unchangedDimensions = false;
    if (keyframe.width === "auto") delete keyframe.width;
    if (keyframe.height === "auto") delete keyframe.height;
    if (keyframe.transform === "none") delete keyframe.transform;
    if (moveAllFramesIntoViewport && keyframe.transform == null) {
      if (keyframe.translate == null || keyframe.translate === "") {
        const elementTranslate = (getComputedStyle(targetElement, pseudoElement) as any).translate;
        keyframe.translate = mergeGestureTranslate(elementTranslate, "20000px 20000px");
      } else {
        keyframe.translate = mergeGestureTranslate(keyframe.translate, "20000px 20000px");
      }
    }
  }
  if (moveFirstFrameIntoViewport) moveOldGestureFrameIntoViewport(keyframes[0]);
  if (unchangedDimensions && width !== undefined && height !== undefined) {
    const computedStyle = getComputedStyle(targetElement, pseudoElement);
    if (computedStyle.width === width && computedStyle.height === height) {
      for (let i = 0; i < keyframes.length; i++) {
        delete keyframes[i].width;
        delete keyframes[i].height;
      }
    }
  }
  // Range start must be <= range end; when reversed we flip the whole animation
  // via `direction` instead.
  const reverse = rangeStart > rangeEnd;
  const options: any = {
    pseudoElement,
    timeline,
    easing: "linear",
    fill: "both",
    direction: reverse ? "normal" : "reverse",
    rangeStart: (reverse ? rangeEnd : rangeStart) + "%",
    rangeEnd: (reverse ? rangeStart : rangeEnd) + "%"
  };
  startedAnimations.push(targetElement.animate(keyframes, options));
}

function bindGestureViewTransitionAnimations(
  transition: BrowserViewTransition,
  gesture: NonNullable<typeof pendingGesture>
) {
  const cleanups: (() => void)[] = [];
  const startedAnimations: Animation[] = [];
  const timeline = gesture.timeline;
  const rangeStart = gesture.options.rangeStart;
  const rangeEnd = gesture.options.rangeEnd;
  const isNativeTimeline =
    typeof AnimationTimeline !== "undefined" && timeline instanceof AnimationTimeline;

  const bindImpl = () => {
    if (typeof document === "undefined") return;
    const documentElement = document.documentElement;
    const getAnimations = documentElement.getAnimations;
    if (typeof getAnimations !== "function") return;
    const animations = getAnimations.call(documentElement, { subtree: true });

    // A view transition ends once its pseudo animations finish (or a ScrollTimeline
    // reaches 100%). A gesture must instead stay open until the app commits/cancels,
    // so park a paused blocking animation that never finishes. React adds this
    // unconditionally; do the same for BOTH paths — otherwise a custom provider that
    // doesn't itself pause every (including post-`ready`) pseudo animation lets the
    // transition self-finish mid-scrub. `release()` ends it via `skipTransition()`.
    const addKeepAlive = () => {
      try {
        const blockingAnim = documentElement.animate([{}, {}], {
          pseudoElement: "::view-transition",
          duration: 1
        } as any);
        blockingAnim.pause();
        startedAnimations.push(blockingAnim);
      } catch (error) {}
    };

    // Custom / non-native provider: hand each pseudo animation to the provider's
    // `animate(animation, range)` hook and let it drive the scrub.
    if (!isNativeTimeline) {
      for (let i = 0; i < animations.length; i++) {
        const animation = animations[i];
        const effect = animation.effect;
        if (!isViewTransitionGestureEffect(effect)) continue;
        try {
          effect.updateTiming({ easing: "linear", fill: "both" });
        } catch (error) {}
        if (timeline && typeof timeline === "object" && "animate" in timeline) {
          const animate = (timeline as { animate?: unknown }).animate;
          if (typeof animate === "function") {
            const cleanup = (animate as (a: Animation, o: unknown) => unknown)(
              animation,
              gesture.options
            );
            if (typeof cleanup === "function") cleanups.push(cleanup as () => void);
          }
        }
      }
      addKeepAlive();
      return;
    }

    // Native AnimationTimeline (e.g. ScrollTimeline): port of React's gesture
    // ready callback. First collect the longest animation so we can map each
    // animation's time-based range onto the gesture's percentage range.
    const foundGroups = new Set<string>();
    const foundNews = new Set<string>();
    let longestDuration = 0;
    for (let i = 0; i < animations.length; i++) {
      const effect = animations[i].effect;
      if (!isViewTransitionGestureEffect(effect) || effect.target !== documentElement) continue;
      const pseudoElement = effect.pseudoElement as string;
      const timing = effect.getTiming();
      const duration = typeof timing.duration === "number" ? timing.duration : 0;
      const durationWithDelay = (timing.delay || 0) + duration;
      if (durationWithDelay > longestDuration) longestDuration = durationWithDelay;
      if (pseudoElement.startsWith("::view-transition-group"))
        foundGroups.add(pseudoElement.slice(23));
      else if (pseudoElement.startsWith("::view-transition-new"))
        foundNews.add(pseudoElement.slice(21));
    }
    const durationToRangeMultiplier =
      longestDuration > 0 ? (rangeEnd - rangeStart) / longestDuration : 0;

    for (let i = 0; i < animations.length; i++) {
      const anim = animations[i];
      if (anim.playState !== "running") continue;
      const effect = anim.effect;
      if (!isViewTransitionGestureEffect(effect) || effect.target !== documentElement) continue;
      const pseudoElement = effect.pseudoElement as string;
      // Recreate rather than mutate (mutable range APIs are unreliable).
      anim.cancel();

      let isGeneratedGroupAnim = false;
      let isExitGroupAnim = false;
      if (pseudoElement.startsWith("::view-transition-group")) {
        const groupName = pseudoElement.slice(23);
        if (foundNews.has(groupName)) {
          const animationName = (anim as { animationName?: string }).animationName;
          isGeneratedGroupAnim =
            animationName != null && animationName.startsWith("-ua-view-transition-group-anim-");
        } else {
          isExitGroupAnim = true;
        }
      }

      const timing = effect.getTiming();
      const duration = typeof timing.duration === "number" ? timing.duration : 0;
      let adjustedRangeStart =
        rangeEnd - (duration + (timing.delay || 0)) * durationToRangeMultiplier;
      let adjustedRangeEnd = rangeEnd - (timing.delay || 0) * durationToRangeMultiplier;
      if (timing.direction === "reverse" || timing.direction === "alternate-reverse") {
        const temp = adjustedRangeStart;
        adjustedRangeStart = adjustedRangeEnd;
        adjustedRangeEnd = temp;
      }

      animateGestureAnimation(
        effect.getKeyframes(),
        effect.target as Element,
        pseudoElement,
        timeline as AnimationTimeline,
        startedAnimations,
        adjustedRangeStart,
        adjustedRangeEnd,
        isGeneratedGroupAnim,
        isExitGroupAnim
      );

      if (pseudoElement.startsWith("::view-transition-old")) {
        const groupName = pseudoElement.slice(21);
        if (!foundGroups.has(groupName) && !foundNews.has(groupName)) {
          foundGroups.add(groupName);
          animateGestureAnimation(
            [{}, {}],
            effect.target as Element,
            "::view-transition-group" + groupName,
            timeline as AnimationTimeline,
            startedAnimations,
            rangeStart,
            rangeEnd,
            false,
            true
          );
        }
      }
    }

    // ScrollTimeline view transitions end when the timeline hits 100%; the paused
    // keep-alive (see addKeepAlive above) holds them open so the gesture can swipe back.
    addKeepAlive();
  };

  // Binding runs deferred (after `ready`, sometimes in a rAF), so a throw here
  // would surface as an unhandled rejection. Degrade gracefully instead.
  const bind = () => {
    try {
      bindImpl();
    } catch (error) {}
  };

  const readyForAnimations =
    isNativeTimeline &&
    typeof navigator !== "undefined" &&
    navigator.userAgent.indexOf("Chrome") !== -1
      ? () => requestAnimationFrame(bind)
      : bind;
  Promise.resolve(transition.ready).then(readyForAnimations, () => {});
  // Run cleanup once the transition settles, on resolve OR reject. `finished` can
  // reject (e.g. a superseding transition aborts this one); `.finally()` would run
  // cleanup but re-throw that rejection as an unhandled promise rejection, so use
  // a two-arg `.then` that swallows it — matching how the wrapped ready/finished
  // promises are defused elsewhere in this module.
  const settleCleanup = () => {
    for (let i = 0; i < startedAnimations.length; i++) {
      try {
        startedAnimations[i].cancel();
      } catch (error) {}
    }
    for (let i = 0; i < cleanups.length; i++) cleanups[i]();
  };
  Promise.resolve(transition.finished).then(settleCleanup, settleCleanup);
}

function getGestureOffset(timeline: GestureProvider) {
  const time =
    timeline && typeof timeline === "object" && "currentTime" in timeline
      ? timeline.currentTime
      : null;
  if (time == null) return 0;
  return typeof time === "number" ? time : Number(time.valueOf());
}

function shouldCommitGesture(timeline: GestureProvider, options: GestureOptionsRequired) {
  const offset = getGestureOffset(timeline);
  const start = options.rangeStart;
  const end = options.rangeEnd;
  return start < end ? offset > start + (end - start) / 2 : offset < end + (start - end) / 2;
}

function resolveViewTransitionClass(
  defaultClass: ViewTransitionClass | undefined,
  eventClass: ViewTransitionClass | undefined
) {
  const types = pendingTransitionTypes;
  const resolve = (value: ViewTransitionClass | undefined) => {
    if (value == null || typeof value === "string") return value;
    let className: string | undefined;
    if (types) {
      for (let i = 0; i < types.length; i++) {
        const match = value[types[i]];
        if (match === "none") return "none";
        if (match != null && match !== "auto")
          className = className ? `${className} ${match}` : match;
      }
    }
    if (className) return className;
    return value.default;
  };
  const resolved = resolve(eventClass) ?? resolve(defaultClass);
  return resolved === "auto" || resolved === "none" ? undefined : resolved;
}

function getTransitionTypes() {
  return pendingTransitionTypes ? [...pendingTransitionTypes] : [];
}

/**
 * Adds a semantic type to the active ViewTransition event.
 *
 * Types are used by Solid's class-map lookup and, when the browser supports
 * ViewTransition.types, are mirrored to the native API so
 * `:active-view-transition-type(...)` selectors can match.
 */
export function addTransitionType(type: string) {
  if (pendingTransitionTypes === null) {
    pendingTransitionTypes = [];
    queueMicrotask(() => {
      pendingTransitionTypes = null;
    });
  }
  if (!pendingTransitionTypes.includes(type)) {
    pendingTransitionTypes.push(type);
    activeViewTransition?.types?.add?.(type);
  }
  // For automatic view transitions: buffer the type so it can be captured onto
  // the transition that will commit later (surviving `pendingTransitionTypes`'
  // microtask clear) — via the `onTransitionInit` hook, which fires when the
  // transition forms (a sync write that triggers async data) or is re-fired by
  // `startTransition` after its scope runs. Only when the seam is installed and
  // not inside a manual transition (which manages its own types).
  if (autoWrapperInstalled && !activeViewTransition) {
    if (pendingAutoTransitionTypes === null) {
      pendingAutoTransitionTypes = [];
      // Clear after this turn so the buffer can't leak into a later, unrelated
      // transition if none forms now. A *macro*task, not a microtask: the
      // scheduler's flush — where the transition initializes and the hook copies
      // these types onto it — is itself a microtask that must run first.
      setTimeout(() => {
        pendingAutoTransitionTypes = null;
      });
    }
    if (!pendingAutoTransitionTypes.includes(type)) pendingAutoTransitionTypes.push(type);
  }
}

function deferredPromise<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function pipeViewTransitionPromise(
  source: PromiseLike<unknown> | undefined,
  fallback: PromiseLike<unknown>,
  resolve: () => void,
  reject: (reason?: unknown) => void
) {
  Promise.resolve(source ?? fallback).then(resolve, reject);
}

// Force a synchronous layout before a gesture View Transition. Works around a
// Safari bug where a clone that includes an unloaded/uncached stylesheet can
// break the transition (ported from React's ReactFiberConfigDOM `forceLayout`).
function forceGestureLayout() {
  if (typeof document === "undefined") return;
  // Read a layout property for its side effect; void it so minifiers keep it.
  void document.documentElement.clientHeight;
}

function startBrowserViewTransition(
  update: () => unknown,
  types: string[] = []
): BrowserViewTransition {
  const start = document.startViewTransition;
  if (typeof start !== "function") {
    let updateResult: unknown;
    try {
      updateResult = update();
    } catch (error) {
      updateResult = Promise.reject(error);
    }
    const updateCallbackDone = Promise.resolve(updateResult);
    return {
      ready: updateCallbackDone,
      finished: updateCallbackDone,
      updateCallbackDone,
      skipTransition() {}
    };
  }

  let transition: BrowserViewTransition;
  if (types.length) {
    try {
      transition = start.call(document, { update, types: [...types] }) as BrowserViewTransition;
    } catch (error) {
      transition = start.call(document, update) as BrowserViewTransition;
    }
  } else {
    try {
      transition = start.call(document, update) as BrowserViewTransition;
    } catch (error) {
      transition = start.call(document, { update }) as BrowserViewTransition;
    }
  }
  // Publish this transition's `finished` so the scheduler's commit gate makes a
  // pending auto commit WAIT for it rather than aborting it (browsers run one at a
  // time). Cleared when it finishes (or is skipped/superseded). The gate re-reads
  // this on its deferred re-flush; the clear runs on the same promise, before the
  // gate's microtask-hopped re-flush, so it never defers forever.
  const finished = Promise.resolve(transition?.finished).catch(() => {});
  activeBrowserVTFinished = finished;
  finished.finally(() => {
    if (activeBrowserVTFinished === finished) activeBrowserVTFinished = null;
  });
  // A skipped or superseded transition rejects `ready`/`finished` with an
  // AbortError, and a given call site only awaits one of them (e.g. exit
  // boundaries read `finished ?? ready`), so the other would surface as an
  // unhandled rejection — console noise on every cancelled/overlapping
  // transition. Attach no-op catches so they are always handled.
  //
  // This does NOT hide real errors: `ready`/`finished` only ever carry transition
  // *lifecycle* outcomes (an AbortError on skip). An error thrown by the update
  // callback is delivered to the caller on `result` and `updateCallbackDone`,
  // which are never swallowed — so an app error still surfaces there. (Defusing
  // only AbortError and re-throwing the rest would just report that same update
  // error three times.) Real consumers still attach their own handlers.
  (transition?.ready as Promise<unknown> | undefined)?.catch(() => {});
  (transition?.finished as Promise<unknown> | undefined)?.catch(() => {});
  return transition;
}

/**
 * Runs a Solid update inside the browser View Transition update callback.
 *
 * This is independent from any router. It is the async-native path for
 * transitions: await route data, `Loading`, or `Reveal` work inside `scope`,
 * then Solid flushes before the browser captures the new snapshot.
 */
export function startViewTransition<T>(
  scope: () => T | Promise<T>,
  options: ViewTransitionScopeOptions = {}
): ViewTransitionScope<T> {
  const ready = deferredPromise<void>();
  const finished = deferredPromise<void>();
  const updateCallbackDone = deferredPromise<void>();
  const result = deferredPromise<Awaited<T>>();
  const previousTypes = pendingTransitionTypes;
  const previousGesture = pendingGesture;
  const previousActiveTransition = activeViewTransition;
  const transitionTypes = options.types
    ? [...options.types]
    : previousTypes
      ? [...previousTypes]
      : [];
  const scopedGesture = options.gesture
    ? {
        timeline: options.gesture.timeline,
        options: {
          rangeStart: options.gesture.options?.rangeStart ?? 0,
          rangeEnd: options.gesture.options?.rangeEnd ?? 1
        }
      }
    : pendingGesture;
  let browserTransition: BrowserViewTransition | undefined;

  const scopedTransition: BrowserViewTransition = {
    ready: ready.promise,
    finished: finished.promise,
    updateCallbackDone: updateCallbackDone.promise,
    types: {
      add(type) {
        if (!transitionTypes.includes(type)) transitionTypes.push(type);
        browserTransition?.types?.add?.(type);
      }
    },
    skipTransition() {
      browserTransition?.skipTransition?.();
    }
  };

  const restore = () => {
    pendingTransitionTypes = previousTypes;
    pendingGesture = previousGesture;
    activeViewTransition = previousActiveTransition;
  };

  const update = () => {
    pendingTransitionTypes = transitionTypes;
    pendingGesture = scopedGesture;
    activeViewTransition = scopedTransition;
    // Measure boundary geometry before the flush mutates the DOM; compare after
    // to fire `update` for boundaries whose size/position changed (React parity).
    snapshotViewTransitionRects();

    try {
      return Promise.resolve(scope()).then(
        value => {
          flush();
          fireViewTransitionUpdates();
          result.resolve(value as Awaited<T>);
          return value;
        },
        error => {
          flush();
          fireViewTransitionUpdates();
          result.reject(error);
          throw error;
        }
      );
    } catch (error) {
      flush();
      fireViewTransitionUpdates();
      result.reject(error);
      throw error;
    }
  };

  try {
    browserTransition = startBrowserViewTransition(
      () => Promise.resolve(update()).finally(restore),
      transitionTypes
    );
    if (browserTransition.types?.add) {
      for (let i = 0; i < transitionTypes.length; i++)
        browserTransition.types.add(transitionTypes[i]);
    }
    if (scopedGesture) bindGestureViewTransitionAnimations(browserTransition, scopedGesture);
    pipeViewTransitionPromise(
      browserTransition.updateCallbackDone,
      result.promise,
      updateCallbackDone.resolve,
      updateCallbackDone.reject
    );
    pipeViewTransitionPromise(
      browserTransition.ready,
      updateCallbackDone.promise,
      ready.resolve,
      ready.reject
    );
    pipeViewTransitionPromise(
      browserTransition.finished,
      updateCallbackDone.promise,
      finished.resolve,
      finished.reject
    );
  } catch (error) {
    restore();
    updateCallbackDone.reject(error);
    ready.reject(error);
    finished.reject(error);
    result.reject(error);
  }

  // A superseded transition (you started a newer one before this finished) skips,
  // rejecting ready/finished with AbortError. That's an expected outcome, not an
  // error, so attach internal no-op handlers: callers who ignore the return value
  // never get an "Uncaught (in promise) AbortError", while callers who await
  // ready/finished still observe the rejection through their own handlers.
  ready.promise.catch(() => {});
  finished.promise.catch(() => {});

  return {
    ready: ready.promise,
    finished: finished.promise,
    updateCallbackDone: updateCallbackDone.promise,
    result: result.promise,
    skipTransition() {
      browserTransition?.skipTransition?.();
    }
  };
}

// Capture types declared synchronously via `addTransitionType` onto the
// transition object as soon as it exists, before its async commit. Fires for
// every (re)init of the transition while the buffer is set, so the transition
// that ultimately commits carries the types even across merges.
const autoTransitionInitHook = (transition: object) => {
  if (pendingAutoTransitionTypes && pendingAutoTransitionTypes.length) {
    autoTransitionTypes.set(transition, [...pendingAutoTransitionTypes]);
  }
};

/**
 * The scheduler seam for automatic view transitions. At a transition's commit,
 * every transition that reaches the DOM (async data, actions, `Loading`/`Reveal`
 * reveals, optimistic commits) runs its DOM mutations inside
 * `document.startViewTransition` — so userland no longer wraps updates in
 * `startViewTransition` itself. The manual `startViewTransition` remains the
 * explicit escape hatch (and the only way to animate a purely synchronous change,
 * which is not a transition).
 *
 * `applyMutations` is the scheduler's render-effect runner (the DOM mutation).
 * Returning the browser transition's `updateCallbackDone` makes the commit
 * async: the scheduler runs layout/user effects and releases its run-guard only
 * after the mutation has been applied inside the update callback.
 */
const autoCommitWrapper = (
  applyMutations: () => void,
  transition: object
): void | PromiseLike<unknown> => {
  // Re-entrancy guard: a manual `startViewTransition` runs `flush()` inside its
  // own update callback, and that flush commits the transition back through
  // here. We're already inside a browser transition, so don't open a nested
  // one — just apply the mutations. The manual path's own
  // `fireViewTransitionUpdates()` fires the boundary events.
  if (activeViewTransition) {
    applyMutations();
    return;
  }
  // (A commit landing while another transition is still animating is handled
  // upstream by the scheduler's commit gate — it defers this whole commit until
  // the running animation finishes, coalescing writes meanwhile — so by the time
  // we get here no browser transition is in flight.)
  // Types for this commit: those captured onto the transition at init (the
  // async path) plus any still in the live buffer (a synchronous commit).
  const captured = autoTransitionTypes.get(transition);
  autoTransitionTypes.delete(transition);
  pendingAutoTransitionTypes = null;
  const types = [...new Set([...(captured ?? []), ...getTransitionTypes()])];
  const gesture = pendingGesture;
  // Stay fully synchronous (identical to pre-seam behavior) unless the browser
  // supports the API AND there is something to animate — a mounted
  // `<ViewTransition>` boundary, an explicit transition type, or a gesture.
  // This keeps ordinary async commits (no view-transition intent) unwrapped
  // and avoids deferring their layout/user effects by a microtask.
  if (
    typeof document.startViewTransition !== "function" ||
    (mountedViewTransitionBoundaries.size === 0 && types.length === 0 && !gesture)
  ) {
    applyMutations();
    return;
  }
  const previousActiveTransition = activeViewTransition;
  // A pre-built context object set as `activeViewTransition` during the update
  // callback. Built up front (not the browser transition itself) because the
  // browser — and the no-native / mocked fallback — may invoke `update`
  // synchronously, before `browserTransition` is assigned. Mirrors the manual
  // path's `scopedTransition`; `types.add`/`skipTransition` forward to the real
  // transition once it exists.
  let browserTransition: BrowserViewTransition | undefined;
  const scopedTransition: BrowserViewTransition = {
    types: {
      add(type) {
        if (!types.includes(type)) types.push(type);
        browserTransition?.types?.add?.(type);
      }
    },
    skipTransition() {
      browserTransition?.skipTransition?.();
    }
  };
  browserTransition = startBrowserViewTransition(() => {
    // Inside the update callback the browser has captured the old state, so the
    // live DOM is still "old": set the active context (so `addTransitionType`
    // and `captureViewTransitionContext` see this transition), snapshot rects,
    // mutate, then fire geometry-driven boundary events — mirroring the manual
    // path's snapshot → flush → fire ordering.
    activeViewTransition = scopedTransition;
    // Surface the captured types to Solid's own class-map + callback `context.types`
    // for this commit (the native transition already got them via `types`). Without
    // this an async auto-commit resolves type-keyed classes (e.g. `{{ async: "…" }}`)
    // to their default, because `pendingTransitionTypes` was microtask-cleared by
    // commit time. Mirrors the manual `startViewTransition` path (which sets it too).
    const previousPendingTypes = pendingTransitionTypes;
    pendingTransitionTypes = types;
    snapshotViewTransitionRects();
    try {
      applyMutations();
      fireViewTransitionUpdates();
    } finally {
      pendingTransitionTypes = previousPendingTypes;
      activeViewTransition = previousActiveTransition;
    }
  }, types);
  if (gesture) bindGestureViewTransitionAnimations(browserTransition, gesture);
  // The scheduler awaits this before running layout/user effects + releasing
  // its run-guard, so the commit stays serialized across the VT async gap.
  return browserTransition.updateCallbackDone;
};

/**
 * Install/uninstall the scheduler seam to match the current state: the wrapper is
 * active exactly while at least one `<ViewTransition>` is mounted. Mounting a
 * boundary is the opt-in — like React, there is no separate enable call — and the
 * wrapper + hook tree-shake away entirely for apps that never render a boundary.
 * Idempotent; called on boundary mount and unmount.
 */
function refreshAutoViewTransitionInstall(): void {
  if (typeof document === "undefined") return;
  const shouldInstall = mountedViewTransitionBoundaries.size > 0;
  if (shouldInstall === autoWrapperInstalled) return;
  autoWrapperInstalled = shouldInstall;
  setTransitionCommitWrapper(shouldInstall ? autoCommitWrapper : null);
  setCommitGate(shouldInstall ? autoCommitGate : null);
  onTransitionInit(shouldInstall ? autoTransitionInitHook : null);
  if (!shouldInstall) pendingAutoTransitionTypes = null;
}

type SelectionState = [start: number, end: number, direction: string];
type FocusableElement = HTMLElement & {
  selectionStart?: number | null;
  selectionEnd?: number | null;
  selectionDirection?: string | null;
  setSelectionRange?: (start: number, end: number, direction?: string) => void;
};

// Serializable live DOM state captured for a `[data-vt-preserve]` element so it
// can be re-asserted after a gesture. Only fields present on the element are set.
type PreservedState = {
  value?: string;
  checked?: boolean;
  open?: boolean;
  currentTime?: number;
  paused?: boolean;
  playbackRate?: number;
  scrollTop?: number;
  scrollLeft?: number;
};

function snapshotPreservedState(el: Element): PreservedState {
  const node = el as any;
  const state: PreservedState = {};
  // Media (<video>/<audio>): playback position, paused, rate.
  if (typeof node.currentTime === "number" && typeof node.playbackRate === "number") {
    state.currentTime = node.currentTime;
    state.paused = node.paused;
    state.playbackRate = node.playbackRate;
  }
  // Form controls (text value lives on inputs/textarea/select, not media/progress).
  if (typeof node.value === "string") state.value = node.value;
  if (typeof node.checked === "boolean") state.checked = node.checked;
  // <details>/<dialog> disclosure.
  else if (typeof node.open === "boolean") state.open = node.open;
  // Scroll offset (only worth restoring if non-zero).
  if (el.scrollTop || el.scrollLeft) {
    state.scrollTop = el.scrollTop;
    state.scrollLeft = el.scrollLeft;
  }
  return state;
}

function applyPreservedState(el: Element, state: PreservedState) {
  const node = el as any;
  try {
    if (state.value !== undefined && typeof node.value === "string" && node.value !== state.value)
      node.value = state.value;
    if (state.checked !== undefined && node.checked !== state.checked) node.checked = state.checked;
    if (state.open !== undefined && typeof node.open === "boolean" && node.open !== state.open)
      node.open = state.open;
    if (state.playbackRate !== undefined && node.playbackRate !== state.playbackRate)
      node.playbackRate = state.playbackRate;
    if (
      state.currentTime !== undefined &&
      typeof node.currentTime === "number" &&
      Math.abs(node.currentTime - state.currentTime) > 0.01
    ) {
      try {
        node.currentTime = state.currentTime;
      } catch (error) {}
    }
    if (state.paused !== undefined) {
      try {
        if (state.paused && typeof node.pause === "function" && !node.paused) node.pause();
        else if (!state.paused && typeof node.play === "function" && node.paused)
          (node.play() as Promise<void> | undefined)?.catch?.(() => {});
      } catch (error) {}
    }
    if (state.scrollTop !== undefined && el.scrollTop !== state.scrollTop)
      el.scrollTop = state.scrollTop;
    if (state.scrollLeft !== undefined && el.scrollLeft !== state.scrollLeft)
      el.scrollLeft = state.scrollLeft;
  } catch (error) {}
}

/**
 * Snapshots interaction state before a gesture mutates the DOM, returning a
 * `restore(final?, recreated?)` that re-asserts it. Two layers:
 *
 * 1. **Focus + caret + scroll of the focused element's scrolled ancestors** — the
 *    identity layer. Solid can't take React's clone-preview approach (its reactive
 *    graph is bound to the live DOM nodes, and `startViewTransition` snapshots the
 *    live document), so reparenting/reordering a focused node blurs it and a
 *    detach+reattach can reset a scroll container. This recovers those casualties
 *    for nodes that *survive* the transition, and is re-asserted on the scrub frame
 *    (`ready`) too so the caret holds during the scrub. It never steals focus the
 *    app moved elsewhere.
 *
 * 2. **Opt-in serializable state of `[data-vt-preserve="<key>"]` elements** — media
 *    `currentTime`/`paused`/`playbackRate`, `<details>`/`<dialog>` open, form
 *    `value`/`checked`, and scroll. This is re-asserted only on the **final** reveal
 *    (commit/cancel), not mid-scrub (so it never fights a legitimate gesture change
 *    that is visually hidden under the snapshot anyway). For a *structurally-replaced*
 *    branch the original node is disposed and recreated; on **cancel** (`recreated`)
 *    the captured state is matched to the recreated element by its app-provided key,
 *    recovering serializable state the identity layer cannot. Non-serializable state
 *    (live `MediaStream`, WebGL contexts, iframe state) still cannot be recovered.
 *
 * `preserveScroll` is false for scroll-driven gestures (a `ScrollTimeline` reads the
 * very offsets we'd otherwise restore), so we don't fight the timeline.
 */
function captureInteractionState(
  preserveScroll: boolean
): ((final?: boolean, recreated?: boolean) => void) | undefined {
  if (typeof document === "undefined") return undefined;

  const active = document.activeElement as FocusableElement | null;
  const hasActive = !!active && active !== document.body;
  let selection: SelectionState | undefined;
  const scrolls: Array<[Element, number, number]> = [];
  if (hasActive && active) {
    try {
      if (
        typeof active.selectionStart === "number" &&
        typeof active.selectionEnd === "number" &&
        typeof active.setSelectionRange === "function"
      ) {
        selection = [
          active.selectionStart,
          active.selectionEnd,
          active.selectionDirection ?? "none"
        ];
      }
    } catch (error) {
      // Inputs like type="email"/"number" throw on selection access — skip it.
    }
    // Scroll offsets of the focused element's scrolled ancestors — the scroll
    // context the user is interacting within. Bounded to the ancestor chain (cheap)
    // and to elements already scrolled (nothing to restore at 0).
    if (preserveScroll) {
      for (let el: Element | null = active; el; el = el.parentElement) {
        if (el.scrollTop || el.scrollLeft) scrolls.push([el, el.scrollTop, el.scrollLeft]);
      }
    }
  }

  // Opt-in serializable state for `[data-vt-preserve]` elements. Cheap: an attribute
  // selector only returns marked elements, and most apps mark none.
  const preserved: Array<{ key: string; node: Element; state: PreservedState }> = [];
  const marked = document.querySelectorAll("[data-vt-preserve]");
  for (let i = 0; i < marked.length; i++) {
    const el = marked[i];
    preserved.push({
      key: el.getAttribute("data-vt-preserve") || "",
      node: el,
      state: snapshotPreservedState(el)
    });
  }

  if (!hasActive && preserved.length === 0) return undefined;

  return (final?: boolean, recreated?: boolean) => {
    // --- identity layer (focus/caret/scroll), always re-asserted ---
    if (hasActive && active) {
      // Re-focus only when the surviving field lost focus to <body>/null — never
      // steal focus the app moved elsewhere.
      if (active.isConnected) {
        const current = document.activeElement;
        if (!current || current === document.body) {
          try {
            active.focus({ preventScroll: true });
            if (selection && typeof active.setSelectionRange === "function") {
              active.setSelectionRange(selection[0], selection[1], selection[2]);
            }
          } catch (error) {
            // Field can't take focus/selection any more — leave it.
          }
        }
      }
      // Restore scroll on any captured ancestor that survived and was reset.
      for (let i = 0; i < scrolls.length; i++) {
        const [el, top, left] = scrolls[i];
        if (!el.isConnected) continue;
        if (el.scrollTop !== top) el.scrollTop = top;
        if (el.scrollLeft !== left) el.scrollLeft = left;
      }
    }

    // --- opt-in serializable layer, only on the final reveal ---
    if (!final || preserved.length === 0) return;
    const recreatedKeys = recreated ? new Set<string>() : undefined;
    for (let i = 0; i < preserved.length; i++) {
      const entry = preserved[i];
      // Surviving node (moved/reparented or unchanged): re-assert onto the same node.
      if (entry.node.isConnected) {
        applyPreservedState(entry.node, entry.state);
        recreatedKeys?.add(entry.key);
      }
    }
    // On cancel, a structurally-replaced branch has been rebuilt as fresh nodes; the
    // origin is back on screen, so match captured state to the recreated element by
    // its app-provided key. (Not done on commit: the destination is showing and a
    // same-key element there is different content.)
    if (recreatedKeys) {
      const live = document.querySelectorAll("[data-vt-preserve]");
      for (let i = 0; i < preserved.length; i++) {
        const entry = preserved[i];
        if (entry.node.isConnected || !entry.key || recreatedKeys.has(entry.key)) continue;
        for (let j = 0; j < live.length; j++) {
          const el = live[j];
          if (el.getAttribute("data-vt-preserve") === entry.key) {
            applyPreservedState(el, entry.state);
            recreatedKeys.add(entry.key);
            break;
          }
        }
      }
    }
  };
}

/**
 * Runs an update with gesture metadata and gesture-driven animation binding for
 * ViewTransition callbacks.
 *
 * Solid binds the resulting view-transition animations to a native
 * `AnimationTimeline`, or passes each animation to a custom provider's
 * `animate(animation, options)` hook. Signal and store writes made by `scope`
 * are transactionally retained until the gesture is committed or cancelled.
 */
export function startGestureTransition<T>(
  timeline: GestureProvider,
  scope: () => T | Promise<T>,
  options: GestureOptions = {}
): GestureViewTransitionScope<T> {
  forceGestureLayout();
  // Mark a gesture in flight so `UnstableKeepAlive` retains (not disposes) branches
  // swapped during the scrub. Balanced by the single `release()` below.
  activeGestureCount++;
  // Snapshot focus/caret (and scroll, unless this is a scroll-driven gesture)
  // before the destination render so a reparented field keeps its caret through
  // the scrub and after commit/cancel re-mutation. A native `AnimationTimeline`
  // may be a `ScrollTimeline`, which reads the offsets we'd restore — so only
  // preserve scroll for custom/plain-object providers.
  const preserveScroll = !(
    typeof AnimationTimeline !== "undefined" && timeline instanceof AnimationTimeline
  );
  const restoreInteraction = captureInteractionState(preserveScroll);
  const gestureOptions: GestureOptionsRequired = {
    rangeStart: options.rangeStart ?? getGestureOffset(timeline),
    rangeEnd: options.rangeEnd ?? (getGestureOffset(timeline) < 50 ? 100 : 0)
  };
  const providerKey = timeline && typeof timeline === "object" ? timeline : undefined;
  let providerState = providerKey ? gestureProviderStates.get(providerKey) : undefined;
  if (providerKey && !providerState) {
    providerState = { count: 0 };
    gestureProviderStates.set(providerKey, providerState);
  }
  if (providerState) providerState.count++;
  let transaction:
    | {
        commit(): void;
        cancel(): void;
      }
    | undefined;
  const transition = startViewTransition(
    () => {
      const scoped = startSolidGestureTransaction(scope, providerState?.transaction);
      transaction = scoped;
      if (providerState) providerState.transaction = scoped;
      return scoped.result;
    },
    {
      gesture: {
        timeline,
        options: gestureOptions
      }
    }
  );
  // Re-assert focus once the destination is rendered and snapshotted (the scrub
  // frame), in case the mutation reparented and blurred the focused field. Only the
  // identity layer runs here (not `final`) — opt-in serializable state is left until
  // the commit/cancel reveal so it never fights a legitimate mid-gesture change.
  if (restoreInteraction)
    transition.ready.then(
      () => restoreInteraction(),
      () => {}
    );
  let released = false;
  const release = (commit: boolean) => {
    if (released) return;
    released = true;
    // This handle is done; decrement the lifecycle ref-count before any early return
    // so it always balances the increment above.
    if (activeGestureCount > 0) activeGestureCount--;
    if (providerState) {
      providerState.count--;
      if (providerState.count > 0) {
        notifyGestureSettle(commit);
        return;
      }
      if (providerKey) gestureProviderStates.delete(providerKey);
    }
    if (commit) transaction?.commit();
    else transaction?.cancel();
    // Finalize the browser transition either way. A scrubbable provider pauses
    // the view-transition pseudo animations to hold the scrub, so their
    // `finished` never resolves on its own — without skipping, a *committed*
    // gesture leaves the destination buried under a frozen full-page snapshot
    // (plus its paused animations) until the next transition supersedes it. This
    // is a real-browser bug: jsdom's mocked `startViewTransition` resolves
    // `finished` synchronously and never surfaces it. `skipTransition()` ends the
    // transition at the current live DOM — which the transaction has just set to
    // the destination (commit) or rolled back to the origin (cancel).
    transition.skipTransition();
    // Commit/cancel re-runs render effects (cancel reverts the DOM); re-assert
    // focus afterward so the caret survives the round trip. This is the final reveal,
    // so the opt-in serializable layer runs too — and on cancel (`!commit`) it can
    // match captured state to a structurally-recreated branch by its preserve key.
    restoreInteraction?.(true, !commit);
    // The gesture has finalized: KeepAlive disposes its retained (non-current)
    // branches now that the DOM is at its committed/cancelled state.
    notifyGestureSettle(commit);
  };
  return Object.assign(transition, {
    commitGesture() {
      release(true);
    },
    cancelGesture() {
      release(false);
    },
    finishGesture() {
      release(shouldCommitGesture(timeline, gestureOptions));
    }
  });
}

/**
 * EXPERIMENTAL — identity-preserving control flow for gesture View Transitions.
 *
 * A drop-in for a keyed `<Show>`: a change to `key` swaps branches. **Outside a
 * gesture** it disposes the outgoing branch immediately (like `<Show keyed>` — no
 * retention, no leak). **During a gesture** it instead DETACHES and RETAINS the
 * outgoing branch (its reactive owner stays live; its nodes move off-document), so
 * `cancelGesture()` reattaches the *same* nodes. Identity — and therefore ALL state,
 * including the non-serializable tail (`<video>`/`MediaStream`, WebGL, a third-party
 * widget, any JS state on the node) that `data-vt-preserve` cannot reach — survives a
 * cancelled scrub. Retained branches are disposed once the gesture settles (commit
 * keeps the destination, cancel keeps the origin).
 *
 * Tradeoffs (see `VIEW_TRANSITIONS.md`): opt-in (use it instead of `<Show>`/`<For>`
 * where you want identity preserved); a retained branch keeps its effects/timers
 * running while detached; and its state persists for the duration of the gesture.
 */
export function UnstableKeepAlive<T>(props: {
  key: T;
  children: (key: T) => JSX.Element;
}): JSX.Element {
  // A neutral mount point (display:contents → no box of its own, so children keep
  // their layout participation and `view-transition-name`).
  const container = document.createElement("div");
  container.style.display = "contents";
  type Entry = {
    holder: HTMLElement;
    dispose: () => void;
    scrolls?: Array<[Element, number, number]>;
  };
  const cache = new Map<T, Entry>();
  let currentKey: T | undefined;
  let hasCurrent = false;

  // Detaching a node from the document resets the scrollTop/Left of its scroll
  // containers even though identity is preserved, so snapshot before detach and
  // re-apply after reattach — otherwise scroll would be the one casualty a cancelled
  // KeepAlive gesture still loses.
  const snapshotScroll = (holder: HTMLElement): Array<[Element, number, number]> => {
    const scrolls: Array<[Element, number, number]> = [];
    const els = holder.querySelectorAll("*");
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      if (el.scrollTop || el.scrollLeft) scrolls.push([el, el.scrollTop, el.scrollLeft]);
    }
    return scrolls;
  };
  const restoreScroll = (scrolls?: Array<[Element, number, number]>) => {
    if (!scrolls) return;
    for (let i = 0; i < scrolls.length; i++) {
      const [el, top, left] = scrolls[i];
      if (!el.isConnected) continue;
      if (el.scrollTop !== top) el.scrollTop = top;
      if (el.scrollLeft !== left) el.scrollLeft = left;
    }
  };

  const build = (key: T): Entry => {
    const holder = document.createElement("div");
    holder.style.display = "contents";
    let dispose!: () => void;
    // Use `insert` (not `children().toArray()`): it resolves the branch in its own
    // tracking scope, so reactive reads aren't flagged STRICT_READ_UNTRACKED — and it
    // handles dynamic/array/text children correctly.
    createRoot(d => {
      dispose = d;
      insert(holder, () => props.children(key));
    });
    return { holder, dispose };
  };

  // The swap runs as a render effect so it executes during the gesture scope (the
  // DOM reaches the destination for the snapshot) while user effects are deferred.
  createRenderEffect(
    () => props.key,
    key => {
      if (hasCurrent && key === currentKey) return;
      if (hasCurrent) {
        const outgoing = cache.get(currentKey as T);
        if (outgoing) {
          if (outgoing.holder.parentNode) {
            // Capture scroll before detaching — detach would otherwise reset it.
            outgoing.scrolls = snapshotScroll(outgoing.holder);
            outgoing.holder.remove();
          }
          // No gesture in flight → behave like keyed `<Show>`: dispose now, no leak.
          // During a gesture → keep the owner live so a cancel can reattach it.
          if (!isGestureActive()) {
            outgoing.dispose();
            cache.delete(currentKey as T);
          }
        }
      }
      let entry = cache.get(key);
      if (!entry) {
        entry = build(key);
        cache.set(key, entry);
      }
      container.appendChild(entry.holder);
      // Re-apply scroll captured when this branch was last detached (same nodes).
      restoreScroll(entry.scrolls);
      currentKey = key;
      hasCurrent = true;
    }
  );

  // Once a gesture settles, dispose every retained branch that is no longer current
  // (the origin on commit, the destination on cancel).
  const unsubscribe = onGestureSettle(() => {
    for (const [key, branch] of cache) {
      if (key === currentKey) continue;
      if (branch.holder.parentNode) branch.holder.remove();
      branch.dispose();
      cache.delete(key);
    }
  });
  onCleanup(() => {
    unsubscribe();
    // Branches are detached roots (not owned by this component's scope), so dispose
    // them explicitly on teardown.
    for (const [, branch] of cache) branch.dispose();
    cache.clear();
  });

  return container as unknown as JSX.Element;
}

// A snapshot of the active view-transition scope, taken synchronously at the
// moment a DOM change is *detected*. React parity: a view-transition event
// (enter / exit / update / share) fires only when the change that triggered it
// committed inside a transition — in React, only Transition / Suspense-retry /
// Idle lanes are view-transition-eligible; a plain `setState` (DefaultLane)
// mutates the DOM with no animation. Solid's analog is "the change happened
// inside a `startViewTransition` scope", which is exactly when
// `activeViewTransition` is set (routers, app transitions, and gestures all
// route through it). `undefined` means no transition was active, so the change
// must not animate.
//
// We capture rather than read `activeViewTransition` at event time because the
// deferred events (the update microtask, the exit batch, the enter/share
// pairing microtask) all run *after* `startViewTransition` restores the
// module-level scope — by then it would read `undefined` (or, worse, a
// different transition). `gesture`/`types` are snapshotted for the same reason.
type ViewTransitionContext = {
  transition: BrowserViewTransition;
  gesture: typeof pendingGesture;
  types: string[];
};

function captureViewTransitionContext(): ViewTransitionContext | undefined {
  if (!activeViewTransition) return undefined;
  return {
    transition: activeViewTransition,
    gesture: pendingGesture,
    types: getTransitionTypes()
  };
}

// React parity (`createMeasurement`/`wasInstanceInViewport` in
// react-dom-bindings ReactFiberConfigDOM.js): a boundary animates and fires its
// callback only when at least one of its host elements is within the viewport
// bounds. React is generous — "we don't care as much about if it was fully
// occluded because then it can still pop out" — so the test is intersection,
// not full visibility. Off-screen boundaries are skipped. (In jsdom every rect
// is 0×0 at the origin, which counts as in-viewport, so this is a no-op there
// and only takes effect in a real browser.)
function isViewTransitionNodeInViewport(node: Element): boolean {
  if (typeof node.getBoundingClientRect !== "function") return true;
  const rect = node.getBoundingClientRect();
  const win = node.ownerDocument?.defaultView;
  if (!win) return true;
  return (
    rect.bottom >= 0 &&
    rect.right >= 0 &&
    rect.top <= win.innerHeight &&
    rect.left <= win.innerWidth
  );
}

function anyViewTransitionNodeInViewport(nodes: readonly Element[]): boolean {
  for (let i = 0; i < nodes.length; i++) if (isViewTransitionNodeInViewport(nodes[i])) return true;
  return false;
}

function runViewTransitionEvent(
  kind: "enter" | "exit" | "share" | "update",
  instance: ViewTransitionInstance,
  props: ViewTransitionProps,
  callback: ViewTransitionCallback | undefined,
  gestureCallback: ViewTransitionGestureCallback | undefined,
  context: ViewTransitionContext
): Promise<unknown> | void {
  // React parity: a boundary with no host element in the viewport does not
  // animate or fire its callback. (The persistent `view-transition-name` stays
  // applied — unlike React, which restores names per-transition — so the
  // browser may still default-cross-fade an off-screen named element; we skip
  // the styled class + the app callback, which is the observable parity.)
  if (instance.nodes.length && !anyViewTransitionNodeInViewport(instance.nodes as Element[]))
    return;
  let cleanup: void | (() => void);
  const types = context.types;
  const gesture = context.gesture;
  const className = resolveViewTransitionClass(props.default, props[kind]);
  const previousClasses = className
    ? instance.nodes.map(node => getViewTransitionClass(node as StyleElement))
    : [];
  const clear = () => {
    cleanup?.();
    if (className) {
      for (let i = 0; i < instance.nodes.length; i++)
        setViewTransitionClass(instance.nodes[i] as StyleElement, previousClasses[i]);
    }
    viewTransitionInternalMutation = false;
  };

  viewTransitionInternalMutation = true;
  if (className) {
    for (let i = 0; i < instance.nodes.length; i++)
      setViewTransitionClass(instance.nodes[i] as StyleElement, className);
  }

  try {
    const transition = context.transition;
    cleanup = gesture
      ? gestureCallback?.(gesture.timeline, gesture.options, instance, types)
      : callback?.(instance, types);
    const done = transition?.finished ?? transition?.ready;
    if (done && typeof done.then === "function") {
      done.then(clear, clear);
      return Promise.resolve(done).catch(() => {});
    }
  } catch (error) {
    clear();
    throw error;
  }
  clear();
}

function ViewTransitionContent(props: ViewTransitionProps) {
  const resolved = children(() => props.children);
  const autoName = `solid-vt-${viewTransitionId++}`;
  // Reactive "is my nearest <Loading> showing content" accessor, if this boundary
  // sits inside one. When present, the mount-time enter is deferred to the reveal
  // effect below (a boundary behind a fallback hasn't really entered yet).
  // Cast bridges the cross-package `Context` type identity (the context is created
  // in @solidjs/signals; `useContext` here is typed against solid-js's re-export).
  const loadingRevealed = useContext(
    LoadingRevealedContext as unknown as Parameters<typeof useContext>[0]
  ) as (() => boolean) | null;
  let mounted = false;
  let mountedName: string | undefined;
  let disposed = false;
  let entered = false;
  let latest: ViewTransitionInstance | undefined;
  const duplicateNameToken = {};
  const boundaryState: ViewTransitionBoundaryState = {
    props,
    updateInFlight: false,
    disposed: false
  };
  mountedViewTransitionBoundaries.add(boundaryState);
  // Mounting a boundary is the opt-in: install the automatic-view-transition seam
  // (no app-level call needed). Uninstalled again when the last boundary unmounts.
  refreshAutoViewTransitionInstall();

  createEffect(
    () => props.name,
    name => {
      if (!isDev || name == null || name === "auto") return;
      const existing = mountedNamedViewTransitions.get(name);
      if (existing && existing !== duplicateNameToken) {
        console.error(
          `There are two <ViewTransition name="${name}"> components with the same name mounted at the same time.`
        );
      }
      mountedNamedViewTransitions.set(name, duplicateNameToken);
      return () => {
        if (mountedNamedViewTransitions.get(name) === duplicateNameToken) {
          mountedNamedViewTransitions.delete(name);
        }
      };
    }
  );

  createRenderEffect(
    () => [props.name, resolved.toArray()] as const,
    ([name, nodes]) => {
      if (disposed) return;
      const elements = collectElements(nodes);
      const transitionName = name && name !== "auto" ? name : autoName;
      latest = createViewTransitionInstance(transitionName, elements);
      boundaryState.latest = latest;
      boundaryState.props = props;

      viewTransitionInternalMutation = true;
      const previousNames = new Array<string>(elements.length);
      const previousClasses = new Array<string>(elements.length);
      for (let i = 0; i < elements.length; i++) {
        previousNames[i] = elements[i].style.viewTransitionName;
        previousClasses[i] = getViewTransitionClass(elements[i]);
        const nodeName = i === 0 ? transitionName : `${transitionName}_${i}`;
        elements[i].style.viewTransitionName = encodeViewTransitionName(nodeName);
      }
      viewTransitionInternalMutation = false;

      if (!mounted) {
        mounted = true;
        mountedName = transitionName;
        // React parity: a mount only animates (enter/share) when it commits
        // inside a transition. Captured synchronously here, while the mounting
        // flush still has `activeViewTransition` set; threaded to the deferred
        // pairing microtask below since the scope is restored before it runs.
        const context = captureViewTransitionContext();
        const replacing = (liveViewTransitionNames.get(transitionName) ?? 0) > 0;
        liveViewTransitionNames.set(
          transitionName,
          (liveViewTransitionNames.get(transitionName) ?? 0) + 1
        );
        const pending = pendingViewTransitionExits.get(transitionName);
        if (pending) {
          // A same-name element departed earlier this flush and registered a
          // pending exit synchronously — pair as a share immediately. Fire when
          // either side committed inside a transition.
          entered = true;
          pending.cancelled = true;
          pendingViewTransitionExits.delete(transitionName);
          const shareContext = context ?? pending.context;
          if (shareContext)
            runViewTransitionEvent(
              "share",
              pending.instance,
              pending.props,
              pending.props.onShare,
              pending.props.onGestureShare,
              shareContext
            );
        } else if (replacing) {
          // A same-name element is still live and about to depart later in this
          // same flush (the appearing element commits before the departing one,
          // matching React's mutation-phase pairing). Defer the enter/share
          // decision one microtask so the departure can claim `entry.departing`
          // and turn this into a share. The lifecycle is mutation-phase work, so
          // it runs even inside a gesture transaction (user effects are held;
          // this render effect is not).
          const entry: AppearingViewTransition = { context };
          appearingViewTransitions.set(transitionName, entry);
          entered = true;
          const enterInstance = latest;
          queueMicrotask(() => {
            if (appearingViewTransitions.get(transitionName) === entry)
              appearingViewTransitions.delete(transitionName);
            if (disposed) return;
            if (entry.departing) {
              const shareContext = entry.context ?? entry.departing.context;
              if (shareContext)
                runViewTransitionEvent(
                  "share",
                  entry.departing.instance,
                  entry.departing.props,
                  entry.departing.props.onShare,
                  entry.departing.props.onGestureShare,
                  shareContext
                );
            } else if (entry.context) {
              runViewTransitionEvent(
                "enter",
                enterInstance,
                props,
                props.onEnter,
                props.onGestureEnter,
                entry.context
              );
            }
          });
        } else if (context && !loadingRevealed) {
          // Fresh mount (no same-name element live or departing): fire enter
          // synchronously — no deferral, so no timing change for the common case.
          // Skipped when inside a <Loading>: the reveal effect below fires enter
          // when the slot's content actually reveals (it may be behind a fallback).
          entered = true;
          runViewTransitionEvent(
            "enter",
            latest,
            props,
            props.onEnter,
            props.onGestureEnter,
            context
          );
        }
      }

      return () => {
        viewTransitionInternalMutation = true;
        for (let i = 0; i < elements.length; i++) {
          elements[i].style.viewTransitionName = previousNames[i];
          setViewTransitionClass(elements[i], previousClasses[i]);
        }
        viewTransitionInternalMutation = false;
      };
    }
  );

  // When this boundary sits inside a <Loading>, its enter is deferred (above) and
  // fired here when the slot is actually showing content. A *user* effect runs
  // after the boundary's suspended state has settled for the flush, so its first
  // run reflects reality: suspended slots read `false` (wait), while content that
  // mounts already-ready reads `true` (fire now). Re-runs on each fallback↔content
  // flip, so each Reveal slot enters as its own content lands (sequential frontier
  // / natural out-of-order), under whatever transition is active at reveal time.
  // `entered` guards against re-firing on a later flip.
  if (loadingRevealed) {
    createEffect(
      () => loadingRevealed(),
      isRevealed => {
        if (isRevealed && !entered && !disposed && latest) {
          const context = captureViewTransitionContext();
          if (context) {
            entered = true;
            runViewTransitionEvent(
              "enter",
              latest,
              props,
              props.onEnter,
              props.onGestureEnter,
              context
            );
          }
        }
      }
    );
  }

  onCleanup(() => {
    disposed = true;
    boundaryState.disposed = true;
    mountedViewTransitionBoundaries.delete(boundaryState);
    // Uninstall the seam once the last boundary is gone (idempotent otherwise).
    refreshAutoViewTransitionInstall();
    if (mountedName !== undefined) {
      const count = (liveViewTransitionNames.get(mountedName) ?? 1) - 1;
      if (count <= 0) liveViewTransitionNames.delete(mountedName);
      else liveViewTransitionNames.set(mountedName, count);
    }
    if (!latest) return;
    // React parity: an unmount only animates when it commits inside a
    // transition. Captured synchronously here (the unmounting flush still has
    // `activeViewTransition` set) and threaded to the deferred exit batch / the
    // share-pairing microtask, both of which run after the scope is restored.
    const context = captureViewTransitionContext();
    const name = latest.name;
    const appearing = appearingViewTransitions.get(name);
    if (appearing && !appearing.departing) {
      // A same-name element mounted earlier this flush and is waiting to decide
      // enter vs share. Claim it as our share partner — its pending microtask
      // fires onShare/onGestureShare with our (departing) props. No exit.
      appearing.departing = { instance: latest, props, context };
      return;
    }
    const record: ExitRecord = {
      name,
      instance: latest,
      props,
      elements: latest.nodes,
      cancelled: false,
      context
    };
    pendingViewTransitionExits.set(name, record);
    exitBatch.push(record);
    if (!exitBatchScheduled) {
      exitBatchScheduled = true;
      queueMicrotask(flushExitBatch);
    }
  });

  return resolved as unknown as JSX.Element;
}

/**
 * Marks a subtree as a browser View Transition participant.
 *
 * The component applies `view-transition-name` to its top-level DOM elements
 * and invokes `document.startViewTransition` for enter, exit, update, and
 * same-name share events when the browser API is present. Update events are
 * detected from Solid's exported DOM property helpers and synchronous text or
 * child-list DOM writes in the rendered subtree; direct third-party attribute
 * stamping is ignored to avoid feedback loops from incidental DOM churn.
 */
export function ViewTransition(props: ViewTransitionProps) {
  return createComponent(ViewTransitionContent, props);
}

/**
 * Build-time constant indicating whether code is running on the server. This
 * client entry sets it to `false`; the matching server entry (`@solidjs/web`
 * resolved through the `solid` server export condition) sets it to `true`.
 *
 * Bundlers can dead-code-eliminate branches gated on `isServer`, so guarding
 * browser-only code with `if (!isServer) {…}` keeps it out of the SSR bundle
 * entirely.
 *
 * @example
 * ```ts
 * import { isServer } from "@solidjs/web";
 *
 * if (!isServer) {
 *   // Browser-only: tree-shaken out of the SSR bundle.
 *   window.addEventListener("resize", onResize);
 * }
 * ```
 */
export const isServer: boolean = false;

/**
 * Build-time constant indicating whether code is running in a dev build.
 * Replaced statically (`_SOLID_DEV_`) by the bundler integration, so guards
 * like `if (isDev) {…}` are stripped from production builds.
 *
 * Use this to gate dev-only diagnostics, warnings, or expensive invariants
 * that should never ship to production.
 *
 * @example
 * ```ts
 * import { isDev } from "@solidjs/web";
 *
 * if (isDev) {
 *   console.warn("debug-only path");
 * }
 * ```
 */
export const isDev: boolean = "_SOLID_DEV_" as unknown as boolean;

type MountableElement = Element | Document | ShadowRoot | DocumentFragment | Node;
export type IntrinsicElement = Extract<keyof JSX.IntrinsicElements, string>;
export type ValidComponent = IntrinsicElement | Component<any> | (string & {});
export type ComponentProps<T extends ValidComponent> =
  T extends Component<infer P>
    ? P
    : T extends keyof JSX.IntrinsicElements
      ? JSX.IntrinsicElements[T]
      : Record<string, unknown>;

export type DynamicProps<T extends ValidComponent, P = ComponentProps<T>> = {
  [K in keyof P]: P[K];
} & {
  component: T | null | undefined | false;
};

/**
 * Renders a component tree into a DOM element. Returns a dispose function
 * that tears the tree down and cleans up reactive scopes when called.
 *
 * @example
 * ```tsx
 * import { render } from "@solidjs/web";
 *
 * const dispose = render(() => <App />, document.getElementById("root")!);
 *
 * // Later, to unmount:
 * dispose();
 * ```
 *
 * @remarks
 * The top-level insert is queued via `insertOptions: { schedule: true }` so
 * its initial DOM attach goes through the effect queue rather than executing
 * inline. This lets the mount participate in transitions: if an uncaught
 * async read surfaces during the initial render (no `Loading` ancestor
 * absorbs it), the mount is held by the transition and attaches atomically
 * once all pending settles. On the no-async happy path the tail `flush()`
 * drains the queued callback so the attach is synchronous by the time
 * `render()` returns. The dev enforcement window scopes
 * `ASYNC_OUTSIDE_LOADING_BOUNDARY` to the initial mount only.
 */
export function render(
  code: () => JSX.Element,
  element: MountableElement,
  init?: unknown,
  options: { renderId?: string } = {}
): () => void {
  // @ts-ignore — replaced at build time
  if ("_DX_DEV_") enforceLoadingBoundary(true);
  try {
    const dispose = (
      renderCore as unknown as (
        code: () => JSX.Element,
        element: MountableElement,
        init: unknown,
        options: { renderId?: string; insertOptions?: { schedule?: boolean } }
      ) => () => void
    )(code, element, init, { ...options, insertOptions: { schedule: true } });
    flush();
    return dispose;
  } finally {
    // @ts-ignore — replaced at build time
    if ("_DX_DEV_") enforceLoadingBoundary(false);
  }
}

/**
 * Resumes a server-rendered tree on the client, attaching event listeners
 * and reactive bindings without reconstructing the DOM. Returns a `dispose`
 * function that tears down reactive scopes (DOM nodes are left in place).
 *
 * Use this when the page HTML was produced by `renderToString`,
 * `renderToStringAsync`, or `renderToStream`. For client-only apps, use
 * `render` instead.
 *
 * Pass `options.renderId` to hydrate one of multiple roots emitted by a
 * server render that used the same id.
 *
 * @example
 * ```tsx
 * import { hydrate } from "@solidjs/web";
 *
 * hydrate(() => <App />, document.getElementById("root")!);
 * ```
 */
export const hydrate: typeof hydrateCore = (...args) => {
  enableHydration();
  return hydrateCore(...args);
};

/**
 * Renders its children into a different part of the DOM (modal roots,
 * tooltips, layers that need to escape an `overflow: hidden` ancestor).
 *
 * If `mount` is omitted, the portal attaches to `document.body`. The portal
 * still participates in the parent's reactive scope and disposes when the
 * parent does.
 *
 * @example
 * ```tsx
 * <Portal mount={document.getElementById("modal-root")!}>
 *   <Dialog />
 * </Portal>
 * ```
 *
 * @description https://docs.solidjs.com/reference/components/portal
 */
export function Portal<T extends boolean = false, S extends boolean = false>(props: {
  mount?: Element;
  children: JSX.Element;
}): JSX.Element {
  const treeMarker = document.createTextNode(""),
    startMarker = document.createTextNode(""),
    endMarker = document.createTextNode(""),
    activityHidden = useContext(ActivityContext),
    mount = () => props.mount || document.body,
    content = createMemo(() => [startMarker, props.children] as unknown as JSX.Element);

  createRenderEffect<[Element, JSX.Element, Owner | null]>(
    // `getOwner()` is captured in the compute-half: the effect-half runs from
    // the queue with no ambient owner, so the insert effect must be parented
    // explicitly or it leaks (NO_OWNER_EFFECT, #2758).
    () => [mount(), content(), getOwner()],
    ([, c, owner]) => {
      const m = untrack(mount);
      m.appendChild(endMarker);
      // The insert effect lives in its own root scoped to this run: it is
      // disposed when the mount changes or the Portal is disposed — not
      // left attached to the component where previous mounts' effects
      // would accumulate. The owner parenting preserves context.
      const dispose = runWithOwner(owner, () =>
        createRoot(d => {
          insert(m, c, endMarker, undefined, { host: () => treeMarker.parentNode });
          return d;
        })
      );
      return () => {
        dispose!();
        let c: Node | null = startMarker;
        while (c && c !== endMarker) {
          const n: Node | null = c.nextSibling;
          m.removeChild(c);
          c = n;
        }
      };
    },
    { schedule: true }
  );

  createEffect(mount, () => {
    const m = untrack(mount);
    const ownerRoot = getDelegatedRoot(treeMarker);
    if (!ownerRoot || (ownerRoot as Node).contains(m)) return;
    registerDelegatedContainer(m, ownerRoot);
    return () => unregisterDelegatedContainer(m, ownerRoot);
  });

  createRenderEffect(
    () => [activityHidden(), content()] as const,
    ([hidden]) => applyPortalActivityHidden(startMarker, endMarker, hidden),
    { schedule: true }
  );

  return treeMarker as unknown as JSX.Element;
}

/**
 * Returns a stable `Component` whose identity is driven by a reactive (and
 * optionally async) `source`. The returned component can be used anywhere a
 * normal component is used; children and props flow through JSX as usual.
 *
 * `source` may return a component, a native tag name (`'input'`, `'textarea'`,
 * etc.), `undefined`, or a `Promise` of any of the above. A pending promise
 * propagates as `NotReadyError` through the surrounding reactive scope, so
 * async swaps compose with `<Loading>` boundaries the same way as `lazy`.
 *
 * @example
 * ```tsx
 * // `source` can return either a custom Component or a native tag
 * // name — they're interchangeable, and the returned reference is a
 * // stable Component you can use anywhere a normal one would go.
 * const Field = dynamic(() => multiline() ? RichTextEditor : "input");
 * return <Field value={value()} onInput={onInput} />;
 * ```
 *
 * @description https://docs.solidjs.com/reference/components/dynamic
 */
export function dynamic<T extends ValidComponent>(
  source: () => T | Promise<T> | null | undefined | false
): Component<ComponentProps<T>> {
  const cached = createMemo<Function | string | undefined>(source as () => any, { lazy: true });
  return props => {
    return createMemo(() => {
      const component = cached();
      switch (typeof component) {
        case "function":
          if (isDev) Object.assign(component, { [$DEVCOMP]: true });
          return untrack(() => (component as Function)(props));

        case "string":
          const el = sharedConfig.hydrating
            ? getNextElement()
            : createElement(
                component as string,
                untrack(() => (props as any).is)
              );
          spread(el, props);
          return el;

        default:
          break;
      }
    }) as unknown as JSX.Element;
  };
}

/**
 * Renders an arbitrary custom or native component and forwards the other
 * props. JSX form of `dynamic()` — same primitive, picked at the JSX site.
 *
 * @example
 * ```tsx
 * <Dynamic
 *   component={multiline() ? RichTextEditor : "input"}
 *   value={value()}
 *   onInput={onInput}
 * />
 * ```
 *
 * @description https://docs.solidjs.com/reference/components/dynamic
 */
export function Dynamic<T extends ValidComponent>(props: DynamicProps<T>): JSX.Element {
  const Comp = dynamic<T>(() => props.component as T | null | undefined | false);
  return createComponent(Comp, omit(props, "component") as ComponentProps<T>);
}

function createElement(tagName: string, is = undefined): HTMLElement | SVGElement | MathMLElement {
  return (
    SVGElements.has(tagName)
      ? document.createElementNS(Namespaces.svg, tagName)
      : MathMLElements.has(tagName)
        ? document.createElementNS(Namespaces.mathml, tagName)
        : document.createElement(tagName, { is })
  ) as HTMLElement | SVGElement | MathMLElement;
}
