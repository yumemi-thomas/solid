/**
 * Test-infrastructure JSX compilation for this monorepo's vitest configs,
 * with two selectable transforms for instant A/B:
 *
 *     pnpm test                           # default: Babel JSX transform
 *     JSX_COMPILER=native pnpm test       # native Rust compiler transform
 *     JSX_COMPILER=native vitest run ...  # single package / config
 *
 * The native path uses `@dom-expressions/compiler` (linked from the sibling
 * checkout — see the TEMPORARY override in pnpm-workspace.yaml) to dogfood
 * the native transform against the whole suite. The Babel path
 * (vite-plugin-solid → babel-preset-solid → @dom-expressions/babel-plugin-jsx)
 * is untouched.
 *
 * NOTE: the default stays on Babel until the known native divergence is
 * fixed: the native compiler misclassifies `ref={x}` when an earlier,
 * already-closed sibling scope declared a `const` of the same name — it
 * resolves the identifier to that stale const binding and emits the
 * function-style `_$ref(() => x, el)` (or inlines a literal into the
 * template) instead of the guarded assignable-variable form. This breaks
 * ref-heavy suites (for/repeat/portal/hydration-parity). Once fixed
 * upstream, flip the default here.
 *
 * How it works: we still instantiate vite-plugin-solid (3.0.0-next.4) so all
 * of its config-side behavior is byte-identical between the two modes
 * (resolve conditions, test.server.deps.external, jest-dom setup, the
 * solid-refresh alias, ...). In native mode we only swap out its `transform`
 * hook for one that runs the same pass pipeline through the native compiler:
 *
 *     lazy() module-URL pass → solid-refresh pass (dev/HMR) → JSX transform
 *
 * The JSX options replicate exactly what the Babel path computes:
 * vite-plugin-solid's getSolidOptions (generate/hydratable from `ssr` +
 * per-request isSsr, dev from command === "serve") merged over
 * babel-preset-solid's defaults (moduleName, builtIns,
 * contextToCustomElements, wrapConditionals), with the config's
 * `solid: {...}` overrides applied last. One deliberate difference: the
 * native refresh pass imports its runtime helpers from the new dev-only
 * `solid-js/refresh` entry (the combination shipping downstream) instead of
 * the plugin's bundled `solid-refresh` virtual module.
 */
import path from "node:path";
import solidPlugin from "vite-plugin-solid";
import {
  transformAsync,
  transformLazyAsync,
  transformRefreshAsync
} from "@dom-expressions/compiler";

// Must match babel-preset-solid's defaults (packages/babel-preset-solid).
const PRESET_DEFAULTS = {
  moduleName: "@solidjs/web",
  builtIns: [
    "For",
    "Show",
    "Switch",
    "Match",
    "Loading",
    "Reveal",
    "Portal",
    "Repeat",
    "Dynamic",
    "Errored"
  ],
  contextToCustomElements: true,
  wrapConditionals: true,
  generate: "dom"
};

// Emitted by the lazy() module-URL pass; resolved against Vite's resolver
// below. Frozen contract shared with vite-plugin-solid / the native compiler.
const LAZY_PLACEHOLDER_RE = /"__SOLID_LAZY_MODULE__:([^"]+)"/g;

export default function solidTestJsx(options = {}) {
  const plugin = solidPlugin(options);

  if (process.env.JSX_COMPILER !== "native") return plugin;

  // Flags mirroring vite-plugin-solid's internals (same expressions).
  let replaceDev = false;
  let needHmr = false;
  let projectRoot = process.cwd();

  const origConfig = plugin.config;
  plugin.config = function (userConfig, env) {
    replaceDev = options.dev === true || (options.dev !== false && env.command === "serve");
    return origConfig.call(this, userConfig, env);
  };

  const origConfigResolved = plugin.configResolved;
  plugin.configResolved = function (config) {
    projectRoot = config.root;
    needHmr =
      config.command === "serve" &&
      config.mode !== "production" &&
      options.hot !== false &&
      !options.refresh?.disabled;
    return origConfigResolved?.call(this, config);
  };

  plugin.transform = async function (source, id, transformOptions) {
    const isSsr = !!(transformOptions && transformOptions.ssr);
    id = id.replace(/\?.*$/, "");
    // Same file gate as vite-plugin-solid (options.extensions unused here).
    if (!/\.[mc]?[tj]sx$/i.test(id)) return null;

    // getSolidOptions parity (vite-plugin-solid).
    let modeOptions;
    if (options.ssr) {
      modeOptions = isSsr
        ? { generate: "ssr", hydratable: true }
        : { generate: "dom", hydratable: true };
    } else {
      modeOptions = { generate: "dom", hydratable: false };
    }
    const jsxOptions = {
      ...PRESET_DEFAULTS,
      ...modeOptions,
      dev: replaceDev,
      ...(options.solid || {})
    };

    // Pass pipeline. Only the final JSX pass emits a sourcemap: the lazy
    // pass is a near-identity rewrite and the refresh pass only wraps
    // top-level components, so the drift is negligible for test stacks and
    // we avoid pulling a map-remapping dependency into test infra.
    let code = source;

    const lazyResult = await transformLazyAsync(code, { filename: id });
    code = lazyResult.code;

    const inNodeModules = /node_modules/.test(id);
    if (needHmr && !isSsr && !inNodeModules) {
      const refreshResult = await transformRefreshAsync(code, {
        filename: id,
        bundler: "vite",
        fixRender: true,
        jsx: false,
        importSource: "solid-js/refresh"
      });
      code = refreshResult.code;
    }

    const result = await transformAsync(code, {
      ...jsxOptions,
      filename: id,
      sourceMap: true
    });
    code = result.code;

    // Resolve lazy() moduleUrl placeholders with Vite's resolver — same
    // logic as vite-plugin-solid's transform.
    const resolutions = [];
    let match;
    while ((match = LAZY_PLACEHOLDER_RE.exec(code)) !== null) {
      const resolved = await this.resolve(match[1], id);
      if (resolved) {
        const cleanId = resolved.id.split("?")[0];
        resolutions.push({
          placeholder: match[0],
          resolved: JSON.stringify(path.relative(projectRoot, cleanId))
        });
      }
    }
    for (const { placeholder, resolved } of resolutions) {
      code = code.replace(placeholder, resolved);
    }

    return { code, map: result.map ?? null };
  };

  return plugin;
}
