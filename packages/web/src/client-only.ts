import {
  createMemo,
  createSignal,
  untrack,
  omit,
  type Component,
  type Setter
} from "solid-js";
import { sharedConfig } from "solid-js/internal";
import type { JSX } from "../jsx/jsx.js";
import type { ComponentProps } from "./dynamic.js";

function loadClientOnly<T>(
  fn: () => Promise<any>,
  setComp: Setter<T | undefined>,
  exportName?: string
) {
  fn().then((m: any) => setComp(() => (exportName ? m[exportName] : m.default)));
}

export function clientOnly<M extends Record<string, any>, K extends keyof M & string>(
  fn: () => Promise<M>,
  options: { lazy?: boolean; export: K },
  moduleUrl?: string
): Component<ComponentProps<M[K]> & { fallback?: JSX.Element }>;
export function clientOnly<T extends Component<any>>(
  fn: () => Promise<{ default: T }>,
  options?: { lazy?: boolean; export?: string },
  moduleUrl?: string
): Component<ComponentProps<T> & { fallback?: JSX.Element }>;
export function clientOnly<T extends Component<any>>(
  fn: () => Promise<any>,
  options: { lazy?: boolean; export?: string } = {},
  _moduleUrl?: string
): Component<ComponentProps<T> & { fallback?: JSX.Element }> {
  const [comp, setComp] = createSignal<T>();
  let started = !options.lazy;
  started && loadClientOnly(fn, setComp, options.export);
  return props => {
    let Comp: T | undefined;
    let m: boolean;
    const rest = omit(props, "fallback") as ComponentProps<T>;
    if (!started) {
      started = true;
      loadClientOnly(fn, setComp, options.export);
    }
    if ((Comp = untrack(comp)) && !sharedConfig.hydrating) return Comp(rest);
    const [mounted, setMounted] = createSignal(!sharedConfig.hydrating);
    const gate = createMemo(
      () => (
        (Comp = comp()),
        (m = mounted()),
        untrack(() => (Comp && m ? Comp(rest) : props.fallback))
      )
    ) as unknown as JSX.Element;
    const onHydrationEnd = sharedConfig.onHydrationEnd;
    const release = () => setMounted(true);
    onHydrationEnd ? onHydrationEnd(release) : queueMicrotask(release);
    return gate;
  };
}
