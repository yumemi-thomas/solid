/// <reference types="vitest" />

import { defineConfig } from "vitest/config";
// Test JSX compiles with the native Rust compiler by default;
// `JSX_COMPILER=babel` switches to the Babel transform for A/B.
import solidPlugin from "vite-plugin-solid";

const compiler = process.env.JSX_COMPILER === "babel" ? "babel" : "native";
import { resolve } from "path";

const rootDir = resolve(__dirname);

export default defineConfig({
  // hot: false — solid-refresh wraps top-level components (e.g. the shared
  // parity-harness scenarios) in HMR wrappers that add owners and break
  // hydration id parity.
  plugins: [solidPlugin({ compiler, hot: false, solid: { dev: true, hydratable: true } })],
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
