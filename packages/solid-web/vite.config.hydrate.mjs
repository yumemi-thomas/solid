/// <reference types="vitest" />

import { defineConfig } from "vitest/config";
import solidPlugin from "vite-plugin-solid";
import { resolve } from "path";

const rootDir = resolve(__dirname);

export default defineConfig({
  // hot: false — solid-refresh wraps top-level components (e.g. the shared
  // parity-harness scenarios) in HMR wrappers that add owners and break
  // hydration id parity.
  plugins: [solidPlugin({ hot: false, solid: { dev: true, hydratable: true } })],
  test: {
    environment: "jsdom",
    pool: "threads",
    globals: true,
    include: ["test/hydration/**/*.spec.tsx"]
  },
  resolve: {
    conditions: ["development", "browser"],
    alias: {
      rxcore: [resolve(rootDir, "../../packages/solid-web/src/core")],
      "@solidjs/web": resolve(rootDir, "src/index.ts")
    }
  }
});
