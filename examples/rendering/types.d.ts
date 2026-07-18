// Local copy of vite-plugin-solid's `virtual-solid-manifest.d.ts` declaration
// (the subpath .d.ts isn't reachable under moduleResolution "Bundler" because
// the plugin's `exports` map only exposes the package root).
declare module "virtual:solid-manifest" {
  import type { ViteManifest } from "vite-plugin-solid";
  const manifest: ViteManifest;
  export default manifest;
}
