/// <reference types="vitest" />

import { defineConfig } from "vitest/config";
// JSX for tests compiles through scripts/solid-jsx.mjs: Babel by default,
// `JSX_COMPILER=native` switches to the native Rust compiler for A/B.
import solidPlugin from "../../scripts/solid-jsx.mjs";
import { resolve } from "path";

const rootDir = resolve(__dirname);

export default defineConfig({
  plugins: [solidPlugin()],
  define: {
    __DEV__: "true",
    __TEST__: "true"
  },
  test: {
    environment: "jsdom",
    pool: "threads",
    globals: true,
    exclude: ["**/node_modules/**"]
  },
  resolve: {
    conditions: ["development", "browser"],
    alias: {
      "@solidjs/signals": [resolve(rootDir, "../solid-signals/src")],
      "solid-js": [resolve(rootDir, "../solid/src")],
      rxcore: [resolve(rootDir, "../solid-web/src/core")],
      "@solidjs/web": [resolve(rootDir, "../solid-web/src")]
    }
  }
});
