import { $REFRESH, type Computed, type Signal } from "./core/index.js";
import { emitDiagnostic } from "./core/dev.js";
import { registerAffectsMark } from "./core/scheduler.js";
import { $TARGET, getStoreAffectsNodes, type Store, type StoreNode } from "./store/store.js";
import type { Accessor } from "./signals.js";

/**
 * Declares that in-flight work will change the targeted data: the named
 * slot(s) — and everything DERIVED from them — read as pending
 * (`isPending` → `true`) from the declaration until the surrounding
 * transaction settles or reverts. Marks ride the same status rails as real
 * in-flight async, so pendingness flows through memos and effects like any
 * other pending source, while the marked values themselves stay readable
 * (a mark is a promise of change, not an absence of value). This is the
 * declaration verb of the pending model — additive only. A mark can turn
 * pending ON for data the graph can't see changing yet; nothing can turn
 * pending OFF while a real change is in flight — a quiet `refresh()`
 * re-ask under a mark still reads pending (declaring the reload is what
 * makes it a real question).
 *
 * Targets:
 * - `affects(store)` — a store proxy (any record, root or nested): every
 *   record reachable from it at declaration time reads pending, including
 *   through captured child proxies (e.g. `<For>` rows). Siblings are
 *   untouched; records added after the declaration are not covered.
 * - `affects(record, key)` — exactly the named slot of the record. One key
 *   per call (keys do NOT form a path — target the owning record directly).
 * - `affects(accessor)` — a source accessor (signal or memo): the source
 *   reads pending.
 *
 * Typically called at the top of an `action` alongside optimistic writes —
 * both are up-front declarations about the same mutation. Outside any
 * transaction the mark is released at the end of the current flush.
 *
 * @example
 * ```ts
 * const send = action(function* (text: string) {
 *   setState(s => { s.messages.push({ text, status: "sending" }); });
 *   affects(state.messages.at(-1)!, "status"); // this slot pends until settle
 *   yield api.send(text);
 * });
 *
 * const reload = action(function* () {
 *   affects(thing);      // the whole store pends…
 *   refresh(thing);      // …over this otherwise-quiet re-ask
 *   yield api.done();
 * });
 * ```
 */
export function affects(target: Accessor<unknown> | Store<object>): void;
export function affects<T extends object>(target: Store<T>, key: keyof T): void;
export function affects(target: any, key?: PropertyKey): void {
  if (__DEV__ && arguments.length > 2) {
    const message =
      "[INVALID_AFFECTS_TARGET] affects() takes a single optional key — extra keys are " +
      "not a path. Mark each slot with its own affects(record, key) call, or pass the " +
      'nested record itself: affects(state.user, "name").';
    emitDiagnostic({
      code: "INVALID_AFFECTS_TARGET",
      kind: "write",
      severity: "error",
      message
    });
    throw new Error(message);
  }
  const storeTarget: StoreNode | undefined = target?.[$TARGET];
  if (storeTarget) {
    const nodes = getStoreAffectsNodes(storeTarget, key);
    for (let i = 0; i < nodes.length; i++) registerAffectsMark(nodes[i]);
    return;
  }
  const node: Signal<any> | Computed<any> | undefined = target?.[$REFRESH];
  if (node) {
    if (__DEV__ && key !== undefined) {
      const message =
        "[INVALID_AFFECTS_TARGET] affects() keys are only valid on store targets. " +
        "An accessor is a single slot — pass it alone, or target the store record that owns the property.";
      emitDiagnostic({
        code: "INVALID_AFFECTS_TARGET",
        kind: "write",
        severity: "error",
        message,
        nodeName: (node as any)._name
      });
      throw new Error(message);
    }
    registerAffectsMark(node);
    return;
  }
  if (__DEV__) {
    const message =
      "[INVALID_AFFECTS_TARGET] affects() expects a Solid source accessor or a store node. " +
      "Pass the store proxy (optionally with a property key) or the original accessor, " +
      "not a wrapper function or an already-read value.";
    emitDiagnostic({
      code: "INVALID_AFFECTS_TARGET",
      kind: "write",
      severity: "error",
      message
    });
    throw new Error(message);
  }
}
