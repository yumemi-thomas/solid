import {
  createOptimistic as coreOptimistic,
  type ComputeFunction,
  type MemoOptions,
  type NoInfer,
  type Signal,
  type SignalOptions
} from "@solidjs/signals";
import { sharedConfig, _hydrateSignalLike } from "./hydration.js";

type HydrationSignalOptions<T> = SignalOptions<T> & MemoOptions<T>;

export const createOptimistic: {
  <T>(): Signal<T | undefined>;
  <T>(value: Exclude<T, Function>, options?: SignalOptions<T>): Signal<T>;
  <T>(
    fn: ComputeFunction<NoInfer<T>, T>,
    options: HydrationSignalOptions<T> & { loadingValue: T }
  ): Signal<T>;
  <T>(
    fn: ComputeFunction<undefined | NoInfer<T>, T>,
    options?: HydrationSignalOptions<T>
  ): Signal<T>;
} = ((...args: any[]) => {
  return typeof args[0] === "function" && sharedConfig.hydrating
    ? _hydrateSignalLike!(coreOptimistic, args[0], args[1])
    : (coreOptimistic as Function)(...args);
}) as any;
