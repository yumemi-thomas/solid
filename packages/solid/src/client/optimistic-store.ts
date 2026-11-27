import {
  createOptimisticStore as coreOptimisticStore,
  type NoFn,
  type ProjectionOptions,
  type Refreshable,
  type Store,
  type StoreOptions,
  type StoreSetter
} from "@solidjs/signals";
import { sharedConfig, _hydrationEnabled } from "./hydration.js";
import { hydrateStoreLike } from "./store-hydration.js";

type HydrationProjectionOptions = ProjectionOptions;
type NoArray<T> = Extract<T, readonly unknown[]> extends never ? unknown : never;

export const createOptimisticStore: {
  <T extends object = {}>(
    initialValue: NoFn<T> | Store<NoFn<T>>,
    options?: StoreOptions
  ): [get: Store<T>, set: StoreSetter<T>];
  <T extends object = {}>(
    fn: (() => T | Promise<T> | AsyncIterable<T>) & NoArray<T>,
    seed?: null,
    options?: Omit<HydrationProjectionOptions, "seedLoadingValue">
  ): [get: Refreshable<Store<T>>, set: StoreSetter<T>];
  <T extends object = {}>(
    fn: (draft: T) => void | T | Promise<void | T> | AsyncIterable<void | T>,
    seed: NoFn<T> | Store<NoFn<T>>,
    options?: HydrationProjectionOptions
  ): [get: Refreshable<Store<T>>, set: StoreSetter<T>];
} = ((...args: any[]) => {
  return _hydrationEnabled && typeof args[0] === "function" && sharedConfig.hydrating
    ? hydrateStoreLike(coreOptimisticStore, args[0], args[1] ?? {}, args[2])
    : (coreOptimisticStore as Function)(...args);
}) as any;
