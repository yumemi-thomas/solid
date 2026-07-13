import { ssrElement } from "./server.js";
import {
  createComponent,
  createMemo,
  omit,
  getOwner,
  getNextChildId,
  sharedConfig,
  NotReadyError,
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
    // `source()` runs once per instance — the memo below is re-pulled by the
    // streaming engine on retry and must not mint a fresh promise each pull.
    const comp = source();
    // Promise sources follow lazy()'s SSR contract: block async renderers and
    // throw NotReadyError from a sync memo until the promise lands, so the
    // engine captures the position as a retry hole. The component itself
    // never crosses the wire; the client re-runs `source()` during hydration,
    // the same way lazy() re-loads its module.
    let p: Promise<T> | undefined;
    let settled = false;
    let value: T | undefined;
    let error: unknown;
    if (comp && typeof (comp as any).then === "function") {
      p = comp as Promise<T>;
      p.then(
        v => {
          value = v;
          settled = true;
        },
        err => {
          error = err;
          settled = true;
        }
      );
      // `context` only exists on the server-side SharedConfig; typed locally
      // so this file checks under both client and server type resolutions.
      const ctx = (sharedConfig as { context?: { async?: boolean; block(p: Promise<any>): void } })
        .context;
      // Swallow rejection here — it's surfaced through the memo below.
      if (ctx?.async)
        ctx.block(
          p.then(
            () => {},
            () => {}
          )
        );
    }
    return createMemo(
      () => {
        let c: unknown = comp;
        if (p) {
          if (!settled) throw new NotReadyError(p);
          if (error) throw error;
          c = value;
        }
        if (c) {
          if (typeof c === "function") return (c as Function)(props);
          if (typeof c === "string") {
            return ssrElement(c, props, undefined, true) as unknown as JSX.Element;
          }
        }
      },
      { sync: true } as any
    ) as unknown as JSX.Element;
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

/**
 * Portals are client-only islands: the server renders nothing for them —
 * `props.children` is never evaluated, no async is started, and nothing is
 * serialized. The client renders the content fresh once hydration settles.
 * Throwing here instead (as earlier betas did) is strictly worse: an ancestor
 * `Errored` catches it and bakes the error fallback into the streamed HTML
 * for a tree that renders fine client-side (#2876).
 *
 * The one thing both sides must still agree on is the parent's child-id
 * counter: the client Portal scopes its internals under one owner (one slot),
 * so consume the matching slot here or every hydration id after the portal
 * drifts.
 */
export function Portal(props: { mount?: Element; children: JSX.Element }) {
  const o = getOwner();
  if (o?.id != null) getNextChildId(o);
  return undefined as unknown as JSX.Element;
}
