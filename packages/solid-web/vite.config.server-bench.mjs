/// <reference types="vitest" />

// Tier-1 SSR-lane bench config. Mirrors `vite.config.server.mjs` (node
// environment, SSR-mode JSX compile, server-build aliases) but only picks up
// `*.bench.tsx` files in `test/server/`. Run via `pnpm bench:server`.

import { defineConfig } from "vitest/config";
// JSX for tests compiles through scripts/solid-jsx.mjs: Babel by default,
// `JSX_COMPILER=native` switches to the native Rust compiler for A/B.
import solidPlugin from "../../scripts/solid-jsx.mjs";
import codspeedPlugin from "@codspeed/vitest-plugin";
import { resolve } from "path";

const rootDir = resolve(import.meta.dirname);

export default defineConfig({
  plugins: [
    solidPlugin({ solid: { generate: "ssr", hydratable: true } }),
    codspeedPlugin()
  ],
  test: {
    environment: "node",
    include: ["test/server/**/*.bench.tsx"],
    globals: true,
    benchmark: {
      include: ["test/server/**/*.bench.tsx"],
      exclude: ["**/node_modules/**", "test/*.bench.tsx"]
    }
  },
  resolve: {
    conditions: ["node"],
    alias: {
      rxcore: resolve(rootDir, "src/core"),
      "@solidjs/web": resolve(rootDir, "server/index.ts"),
      "solid-js": resolve(rootDir, "../solid/src/server/index.ts")
    }
  }
});
