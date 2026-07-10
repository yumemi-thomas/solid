import {
  NotReadyError,
  createMemo,
  getNextChildId,
  peekNextChildId,
  getOwner,
  getContext,
  NoHydrateContext
} from "./signals.js";
import { sharedConfig } from "./shared.js";
import type { Element as SolidElement } from "../types.js";

export function enableHydration() {}

/**
 * A general `Component` has no implicit `children` prop. If desired, specify
 * one explicitly, e.g. `Component<{ name: string; children: Element }>`.
 */
export type Component<P extends Record<string, any> = {}> = (props: P) => SolidElement;

/**
 * Extend props to forbid the `children` prop.
 */
export type VoidProps<P extends Record<string, any> = {}> = P & { children?: never };
/**
 * `VoidComponent` forbids the `children` prop.
 */
export type VoidComponent<P extends Record<string, any> = {}> = Component<VoidProps<P>>;

/**
 * Extend props to allow optional Solid children.
 */
export type ParentProps<P extends Record<string, any> = {}> = P & { children?: SolidElement };
/**
 * `ParentComponent` allows an optional `children` prop with the usual type in JSX.
 */
export type ParentComponent<P extends Record<string, any> = {}> = Component<ParentProps<P>>;

/**
 * Extend props to require a `children` prop with the specified type.
 */
export type FlowProps<P extends Record<string, any> = {}, C = SolidElement> = P & { children: C };
/**
 * `FlowComponent` requires a `children` prop with the specified type.
 */
export type FlowComponent<P extends Record<string, any> = {}, C = SolidElement> = Component<
  FlowProps<P, C>
>;

export type ValidComponent = Component<any>;

/**
 * Takes the props of the passed component and returns its type
 */
export type ComponentProps<T extends ValidComponent> = T extends Component<infer P> ? P : never;

/**
 * Type of `props.ref`, for use in `Component` or `props` typing.
 */
export type Ref<T> = T | ((val: T) => void);

/**
 * Creates a component. On server, just calls the function directly (no untrack needed).
 */
export function createComponent<T extends Record<string, any>>(
  Comp: Component<T>,
  props: T
): SolidElement {
  return Comp(props || ({} as T));
}

/**
 * Lazy load a function component asynchronously.
 * On server, returns a createMemo that throws NotReadyError until the module resolves,
 * allowing resolveSSRNode to capture it as a fine-grained hole. The memo naturally
 * scopes the owner so hydration IDs align with the client's createMemo in lazy().
 * The bundler plugin injects `moduleUrl` (the module specifier) so the server
 * can look up client chunk URLs from the asset manifest. When no callsite
 * `moduleUrl` exists (e.g. `lazy` over an `import.meta.glob` entry), asset
 * resolution defers until the import resolves and reads the module's
 * bundler-injected `$$moduleUrl` export instead.
 *
 * The returned component's `moduleUrl` property resolves through the active
 * request's asset manifest: inside SSR it returns the client-loadable entry
 * URL for the module (e.g. `/assets/About-abc123.js`), suitable for stamping
 * into markup (island containers and similar). Outside a request context it
 * returns the raw module specifier. Reading it during SSR also registers a
 * modulepreload hint for the module's chunks — accessing the resolved client
 * URL on the server is treated as a declaration that the client will fetch it.
 */
export function lazy<T extends Component<any>>(
  fn: () => Promise<{ default: T }>,
  moduleUrl?: string
): T & { preload: () => Promise<{ default: T }>; moduleUrl?: string } {
  let p: Promise<{ default: T }> & { v?: T; error?: unknown; errored?: boolean };
  let load = () => {
    if (!p) {
      p = fn() as any;
      p.then(
        mod => {
          p.v = mod.default;
        },
        err => {
          // Capture the rejection so the SSR render path can surface it to
          // `<Errored>` instead of leaving p.v `undefined` forever (which
          // would keep throwing `NotReadyError` and look like the module is
          // still loading) and instead of leaking the rejection as a
          // process-level `unhandledRejection` (#2780). Presence is a flag —
          // a falsy rejection value is still a rejection (#2857).
          p.error = err;
          p.errored = true;
        }
      );
    }
    return p;
  };
  const wrap: Component<ComponentProps<T>> & {
    preload?: () => Promise<{ default: T }>;
    moduleUrl?: string;
  } = props => {
    const noHydrate = getContext(NoHydrateContext);
    if (!noHydrate && !sharedConfig.context?.resolveAssets) {
      throw new Error(
        `lazy() called${moduleUrl ? ` with moduleUrl "${moduleUrl}"` : ""} but no asset manifest is set. ` +
          "Pass a manifest option to renderToStream/renderToString."
      );
    }
    load();
    const ctx = sharedConfig.context;
    // Asset registration is separate from rendering: the manifest guard above
    // is waived for no-hydrate zones (nothing hydrates, so no assets are
    // needed), and those zones must still render their resolved module.
    // Fusing this into an early return dropped the content entirely for
    // exactly the waived cases (#2859).
    if (ctx?.registerAsset && ctx.resolveAssets) {
      // The module mapping is keyed by the hydration id the render memo below
      // will receive (peek — creating the memo consumes the slot). The
      // client's lazy() computes the same id positionally during hydration,
      // so no module identity needs to exist client-side.
      const o = getOwner();
      const hydrationKey = !noHydrate && o?.id != null ? peekNextChildId(o) : undefined;
      const registerLazyAssets = (id: string) => {
        const assets = ctx.resolveAssets!(id);
        if (!assets) return;
        for (let i = 0; i < assets.css.length; i++) ctx.registerAsset!("style", assets.css[i]);
        if (!noHydrate) {
          for (let i = 0; i < assets.js.length; i++) ctx.registerAsset!("module", assets.js[i]);
          if (hydrationKey != null) ctx.registerModule?.(hydrationKey, assets.js[0]);
        }
      };
      if (moduleUrl) {
        registerLazyAssets(moduleUrl);
      } else if (!noHydrate) {
        // No callsite moduleUrl (e.g. lazy over import.meta.glob) — the
        // module's identity lives in the module itself: the bundler's SSR
        // transform injects a `$$moduleUrl` export carrying the client
        // manifest key. Defer registration until the import resolves; this
        // .then is attached before ctx.block's (below), so for streaming it
        // settles before the owning boundary can flush its asset map.
        const boundary = ctx._currentBoundaryId;
        p.then(mod => {
          const id = (mod as any)?.$$moduleUrl;
          if (typeof id !== "string") {
            console.warn(
              "lazy() used in SSR without a moduleUrl and the loaded module has no " +
                "$$moduleUrl export, so its client assets cannot be resolved — the " +
                "component will load late during hydration. This is typically " +
                "injected by the bundler plugin."
            );
            return;
          }
          // Restore the boundary that owned this render — by the time the
          // import settles, other boundaries may be rendering.
          const current = ctx._currentBoundaryId;
          ctx._currentBoundaryId = boundary;
          try {
            registerLazyAssets(id);
          } finally {
            ctx._currentBoundaryId = current;
          }
        });
      }
    }
    if (ctx?.async) {
      ctx.block(
        p.then(
          () => {
            (p as any).s = "success";
          },
          () => {
            // Rejection is captured on `p.error` by `load()` and surfaced
            // through the memo below; swallow the rejection of this branch
            // so `ctx.block` doesn't propagate a second unhandled rejection.
          }
        )
      );
    }
    return createMemo(
      () => {
        if (p.errored) throw p.error;
        if (!p.v) throw new NotReadyError(p);
        return p.v(props);
      },
      { sync: true }
    ) as unknown as SolidElement;
  };
  wrap.preload = load;
  Object.defineProperty(wrap, "moduleUrl", {
    get() {
      const ctx = sharedConfig.context;
      if (moduleUrl && ctx?.resolveAssets) {
        const assets = ctx.resolveAssets(moduleUrl);
        if (assets && assets.js.length) {
          // Lazy components under NoHydration (e.g. islands) skip module
          // registration during render, so this access is the only signal
          // that the client will fetch these chunks.
          if (ctx.registerAsset) {
            for (let i = 0; i < assets.js.length; i++) ctx.registerAsset("module", assets.js[i]);
          }
          return assets.js[0];
        }
      }
      return moduleUrl;
    },
    configurable: true,
    enumerable: true
  });
  return wrap as T & { preload: () => Promise<{ default: T }>; moduleUrl?: string };
}

export function createUniqueId(): string {
  const o = getOwner();
  if (!o) throw new Error(`createUniqueId cannot be used outside of a reactive context`);
  return getNextChildId(o);
}
