import {
  createDeferred as coreDeferred,
  type ComputeFunction,
  type MemoOptions,
  type NoInfer,
  type SourceAccessor
} from "@solidjs/signals";
import { sharedConfig, _hydrateSignalLike } from "./hydration.js";

type HydrationMemoOptions<T> = MemoOptions<T>;

export const createDeferred: {
  <T>(
    compute: ComputeFunction<NoInfer<T>, T>,
    options: HydrationMemoOptions<T> & { loadingValue: T }
  ): SourceAccessor<T>;
  <T>(
    compute: ComputeFunction<undefined | NoInfer<T>, T>,
    options?: HydrationMemoOptions<T>
  ): SourceAccessor<T>;
} = ((fn: any, options?: any) =>
  sharedConfig.hydrating
    ? _hydrateSignalLike!(coreDeferred, fn, options)
    : coreDeferred(fn, options)) as any;
