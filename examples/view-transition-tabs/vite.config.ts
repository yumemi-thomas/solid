import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";

const repo = (path: string) => fileURLToPath(new URL(`../../${path}`, import.meta.url));

export default defineConfig(({ command }) => ({
  // The workspace packages are aliased to source (below), which still contains
  // the library's compile-time flags. The package builds replace these via
  // rollup; here we must define them ourselves or they leak as undefined
  // globals at runtime (ReferenceError: __DEV__ is not defined).
  define: {
    __DEV__: JSON.stringify(command === "serve"),
    __TEST__: "false"
  },
  plugins: [tailwindcss(), solid()],
  resolve: {
    conditions: ["development", "browser", "import"],
    alias: {
      rxcore: repo("packages/solid-web/src/core"),
      "@solidjs/web/jsx-runtime": repo("packages/solid-web/src/index.ts"),
      "@solidjs/web/jsx-dev-runtime": repo("packages/solid-web/src/index.ts"),
      "@solidjs/web": repo("packages/solid-web/src/index.ts"),
      "@solidjs/signals": repo("packages/solid-signals/src/index.ts"),
      "solid-js": repo("packages/solid/src/index.ts")
    }
  },
  optimizeDeps: {
    noDiscovery: true,
    include: []
  },
  server: {
    port: 5174
  }
}));
