/** @jsxImportSource @solidjs/web */

import { createSignal, For, Match, Show, Switch } from "solid-js";
import {
  Activity,
  addTransitionType,
  startGestureTransition,
  startViewTransition,
  ViewTransition,
  type GestureOptionsRequired,
  type ViewTransitionScope,
  type ViewTransitionInstance
} from "@solidjs/web";

const [count] = createSignal(1);

<Show when={count()}>{value => <div>{value()}</div>}</Show>;
<Show when={count()} keyed>
  {value => <div>{value.toFixed()}</div>}
</Show>;
<Show when={count()}>{count()}</Show>;
// @ts-expect-error zero-arg callback children are ambiguous and should not typecheck in JSX
<Show when={count()}>{() => <div />}</Show>;
// @ts-expect-error bare accessors should be invoked before being passed as JSX children
<Show when={count()}>{count}</Show>;
<Show when={count()} keyed>
  {value => (
    // @ts-expect-error keyed Show passes a raw value, not an accessor
    <div>{value()}</div>
  )}
</Show>;

<Switch fallback={<div>fallback</div>}>
  <Match when={count()}>{value => <div>{value()}</div>}</Match>
  <Match when={count()} keyed>
    {value => <div>{value.toFixed()}</div>}
  </Match>
  <Match when={true}>ok</Match>
</Switch>;

<Match when={count()}>{value => <div>{value()}</div>}</Match>;
<Match when={count()} keyed>
  {value => <div>{value.toFixed()}</div>}
</Match>;
<Match when={count()}>{count()}</Match>;
<Match when={count()} keyed>
  {value => (
    // @ts-expect-error keyed Match passes a raw value, not an accessor
    <div>{value()}</div>
  )}
</Match>;

const rows = [{ id: "a", label: "A" }];
<For each={rows}>{(row, index) => <div data-index={index()}>{row.label}</div>}</For>;
<For each={rows} keyed>
  {(row, index) => <div data-index={index()}>{row.label}</div>}
</For>;
<For each={rows} keyed={false}>
  {(row, index) => <div data-index={index}>{row().label}</div>}
</For>;
<For each={rows} keyed={row => row.id}>
  {(row, index) => <div data-index={index()}>{row().label}</div>}
</For>;
// @ts-expect-error default For passes a raw row, not an accessor
<For each={rows}>{row => <div>{row().label}</div>}</For>;
<For each={rows} keyed={false}>
  {(row, index) => (
    // @ts-expect-error keyed:false passes a raw index, not an accessor
    <div>{index()}</div>
  )}
</For>;
<For each={rows} keyed={row => row.id}>
  {row => (
    // @ts-expect-error key-function For passes an item accessor, not a raw row
    <div>{row.label}</div>
  )}
</For>;

<Activity mode="hidden">
  <div />
</Activity>;
<Activity mode="visible">
  <div />
</Activity>;
// @ts-expect-error Activity only accepts visible, hidden, null, or undefined modes
<Activity mode="collapsed">
  <div />
</Activity>;

<ViewTransition
  name="hero"
  default="card"
  enter={{ default: "card-enter", route: "route-enter" }}
  onEnter={(instance: ViewTransitionInstance, types) => {
    instance.nodes.forEach(node => node.nodeType);
    instance.old.animate([{ opacity: 0 }], { duration: 120 });
    instance.new.getAnimations().forEach(animation => animation.cancel());
    instance.group.getComputedStyle().opacity;
    types.forEach(type => type.toUpperCase());
  }}
  onGestureEnter={(timeline, options: GestureOptionsRequired, instance, types) => {
    timeline;
    options.rangeStart.toFixed();
    instance.nodes.forEach(node => node.nodeType);
    types.forEach(type => type.toUpperCase());
  }}
>
  <div />
</ViewTransition>;
addTransitionType("route");
const gestureTransition = startGestureTransition(
  { currentTime: 0 },
  () => addTransitionType("gesture"),
  {
    rangeStart: 0,
    rangeEnd: 1
  }
);
gestureTransition.finished.then(() => {});
gestureTransition.commitGesture();
gestureTransition.cancelGesture();
gestureTransition.finishGesture();
const asyncTransition: ViewTransitionScope<string> = startViewTransition(
  async () => {
    addTransitionType("async-route");
    return "done";
  },
  { types: ["route"] }
);
asyncTransition.result.then(value => value.toUpperCase());
// @ts-expect-error addTransitionType requires a string transition type
addTransitionType(1);
// @ts-expect-error startViewTransition requires a function scope
startViewTransition("route");
// @ts-expect-error ViewTransition callbacks receive an instance and active type list
<ViewTransition onUpdate={(name: string) => name} />;
// @ts-expect-error gesture callbacks receive timeline, options, instance, and active type list
<ViewTransition onGestureUpdate={(instance: ViewTransitionInstance) => instance} />;
