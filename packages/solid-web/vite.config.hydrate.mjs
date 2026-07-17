/// <reference types="vitest" />

import { defineConfig } from "vitest/config";
// JSX for tests compiles through scripts/solid-jsx.mjs: Babel by default,
// `JSX_COMPILER=native` switches to the native Rust compiler for A/B.
import solidPlugin from "../../scripts/solid-jsx.mjs";
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
