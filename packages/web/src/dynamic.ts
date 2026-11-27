import {
  getNextElement,
  runHydrationEvents,
  SVGElements,
  MathMLElements,
  Namespaces
} from "./client.js";
import { spread } from "./spread.js";
import {
  createComponent,
  untrack,
  omit,
  type Component,
  type DynamicOptions
} from "solid-js";
import { dynamicCore, sharedConfig } from "solid-js/internal";
import type { JSX } from "../jsx/jsx.js";

export type IntrinsicElement = Extract<keyof JSX.IntrinsicElements, string>;
export type ValidComponent = IntrinsicElement | Component<any> | (string & {});
export type ComponentProps<T extends ValidComponent> =
  T extends Component<infer P>
    ? P
    : T extends keyof JSX.IntrinsicElements
      ? JSX.IntrinsicElements[T]
      : Record<string, unknown>;

/** @deprecated Props of the deprecated `<Dynamic>`; see `dynamic()`. */
export type DynamicProps<T extends ValidComponent, P = ComponentProps<T>> = {
  [K in keyof P]: P[K];
} & {
  component: T | null | undefined | false;
};

export function dynamic<T extends ValidComponent>(
  source: () => T | Promise<T> | AsyncIterable<T> | null | undefined | false,
  options?: DynamicOptions
): Component<ComponentProps<T>> {
  return dynamicCore(source, options, staticElement);
}

function staticElement(tag: string, props: any): JSX.Element {
  const hydrating = sharedConfig.hydrating;
  const create = () =>
    createElement(
      tag,
      untrack(() => props.is),
      untrack(() => props.xmlns)
    );
  const el = hydrating ? getNextElement(create) : create();
  spread(el, props);
  if (hydrating) runHydrationEvents();
  return el as unknown as JSX.Element;
}

export function Dynamic<T extends ValidComponent>(props: DynamicProps<T>): JSX.Element {
  const Comp = dynamic<T>(() => props.component as T | null | undefined | false);
  return createComponent(Comp, omit(props, "component") as ComponentProps<T>);
}

function createElement(
  tagName: string,
  is: string | undefined = undefined,
  xmlns: string | undefined = undefined
): HTMLElement | SVGElement | MathMLElement {
  return (
    xmlns
      ? document.createElementNS(xmlns, tagName, { is })
      : SVGElements.has(tagName)
        ? document.createElementNS(Namespaces.svg, tagName)
        : MathMLElements.has(tagName)
          ? document.createElementNS(Namespaces.mathml, tagName)
          : document.createElement(tagName, { is })
  ) as HTMLElement | SVGElement | MathMLElement;
}
