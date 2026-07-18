/// <reference types="vitest" />

import { defineConfig } from "vitest/config";
// vite-plugin-solid is TEMPORARILY linked to the sibling checkout (see
// pnpm-workspace.yaml). Test JSX compiles with the native Rust compiler by
// default; `JSX_COMPILER=babel` switches to the Babel transform for A/B.
import solidPlugin from "vite-plugin-solid";

const compiler = process.env.JSX_COMPILER === "babel" ? "babel" : "native";
import { resolve } from "path";

const rootDir = resolve(import.meta.dirname);

export default defineConfig({
  plugins: [solidPlugin({ compiler, solid: { generate: "ssr", hydratable: true } })],
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
