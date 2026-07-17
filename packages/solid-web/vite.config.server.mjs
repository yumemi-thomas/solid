/// <reference types="vitest" />

import { defineConfig } from "vitest/config";
// JSX for tests compiles through scripts/solid-jsx.mjs: Babel by default,
// `JSX_COMPILER=native` switches to the native Rust compiler for A/B.
import solidPlugin from "../../scripts/solid-jsx.mjs";
import { resolve } from "path";

const rootDir = resolve(import.meta.dirname);

export default defineConfig({
  plugins: [solidPlugin({ solid: { generate: "ssr", hydratable: true } })],
  test: {
    environment: "node",
    include: ["test/server/**/*.spec.tsx"],
    globals: true,
    pool: "threads",
  },
  resolve: {
    conditions: ["node"],
    alias: {
      rxcore: resolve(rootDir, "src/core"),
      "@solidjs/web": resolve(rootDir, "server/index.ts"),
      "solid-js": resolve(rootDir, "../solid/src/server/index.ts"),
    }
  }
});
