import { ssrElement } from "./server.js";
import {
  createComponent,
  omit,
  getOwner,
  getNextChildId,
  createOwner,
  runWithOwner,
  flush,
  type Component
} from "solid-js";
import type { JSX } from "../src/jsx.js";

export * from "./server.js";
export type { JSX } from "../src/jsx.js";

export {
  For,
  Show,
  Loading,
  Reveal,
  Switch,
  Match,
  Repeat,
  Errored,
  NoHydration,
  Hydration
} from "solid-js";

/**
 * Build-time constant indicating whether code is running on the server. This
 * is the server entry; the value is `true`. The client entry of `@solidjs/web`
 * sets it to `false`. See the client-entry JSDoc for the canonical guard
 * pattern.
 */
export const isServer: boolean = true;

/**
 * Build-time constant indicating whether code is running in a dev build.
 * The server entry hard-codes `false` (SSR builds are production by
 * convention); the client entry's value is set by `_SOLID_DEV_` substitution.
 */
export const isDev: boolean = false;

export type IntrinsicElement = Extract<keyof JSX.IntrinsicElements, string>;
export type ValidComponent = IntrinsicElement | Component<any> | (string & {});
export type ComponentProps<T extends ValidComponent> =
  T extends Component<infer P>
    ? P
    : T extends keyof JSX.IntrinsicElements
      ? JSX.IntrinsicElements[T]
      : Record<string, unknown>;

export function dynamic<T extends ValidComponent>(
  source: () => T | Promise<T> | null | undefined | false
): Component<ComponentProps<T>> {
  const o = getOwner();
  if (o?.id != null) getNextChildId(o);
  return props => {
    const memoOwner = createOwner();

    return runWithOwner(memoOwner, () => {
      const comp = source(),
        t = typeof comp;

      if (comp) {
        if (t === "function") return (comp as Function)(props);
        else if (t === "string") {
          return ssrElement(comp as string, props, undefined, true) as unknown as JSX.Element;
        }
      }
    }) as JSX.Element;
  };
}

export type DynamicProps<T extends ValidComponent, P = ComponentProps<T>> = {
  [K in keyof P]: P[K];
} & {
  component: T | null | undefined | false;
};

export function Dynamic<T extends ValidComponent>(props: DynamicProps<T>): JSX.Element {
  const Comp = dynamic<T>(() => props.component as T | null | undefined | false);
  return createComponent(Comp, omit(props, "component") as ComponentProps<T>);
}

export function Portal(props: { mount?: Node; useShadow?: boolean; children: JSX.Element }) {
  throw new Error("Portal is not supported on the server");
}

export function Activity(props: {
  mode?: "hidden" | "visible" | null | undefined;
  name?: string;
  children?: JSX.Element;
}) {
  return props.children;
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

export function addTransitionType(_type: string) {}

function noopViewTransitionScope<T>(result: T | Promise<T>): ViewTransitionScope<T> {
  const value = Promise.resolve(result) as Promise<Awaited<T>>;
  const done = value.then(() => {});
  return {
    ready: done,
    finished: done,
    updateCallbackDone: done,
    result: value,
    skipTransition() {}
  };
}

export function startViewTransition<T>(
  scope: () => T | Promise<T>,
  _options: ViewTransitionScopeOptions = {}
) {
  const result = scope();
  flush();
  return noopViewTransitionScope(result);
}

export function startGestureTransition<T>(
  _timeline: GestureProvider,
  scope: () => T | Promise<T>,
  _options: GestureOptions = {}
): GestureViewTransitionScope<T> {
  return Object.assign(startViewTransition(scope), {
    commitGesture() {},
    cancelGesture() {},
    finishGesture() {}
  });
}

export function ViewTransition(props: ViewTransitionProps) {
  return props.children;
}

// Gestures don't exist on the server; render the current branch like keyed `<Show>`.
export function UnstableKeepAlive<T>(props: { key: T; children: (key: T) => JSX.Element }) {
  return props.children(props.key);
}
