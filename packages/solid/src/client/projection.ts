import {
  createProjection as coreProjection,
  type NoFn,
  type ProjectionOptions,
  type Refreshable,
  type Store
} from "@solidjs/signals";
import { sharedConfig, _hydrationEnabled } from "./hydration.js";
import { hydrateStoreLike } from "./store-hydration.js";

type HydrationProjectionOptions = ProjectionOptions;
type NoArray<T> = Extract<T, readonly unknown[]> extends never ? unknown : never;

export const createProjection: {
  <T extends object = {}>(
    fn: (() => T | Promise<T> | AsyncIterable<T>) & NoArray<T>,
    seed?: null,
    options?: Omit<HydrationProjectionOptions, "seedLoadingValue">
  ): Refreshable<Store<T>>;
  <T extends object = {}>(
    fn: (draft: T) => void | T | Promise<void | T> | AsyncIterable<void | T>,
    seed: NoFn<T> | Store<NoFn<T>>,
    options?: HydrationProjectionOptions
  ): Refreshable<Store<T>>;
} = ((...args: any[]) => {
  return _hydrationEnabled && sharedConfig.hydrating
    ? hydrateStoreLike(coreProjection, args[0], args[1] ?? {}, args[2])
    : (coreProjection as Function)(...args);
}) as any;
