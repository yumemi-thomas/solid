import { defineConfig } from "vitest/config";
import solid from "vite-plugin-solid";
import { resolve } from "path";

const root = resolve(import.meta.dirname);
const sj = resolve(root, "node_modules/solid-js");

export default defineConfig({
  plugins: [solid({ solid: { generate: "ssr", hydratable: true } })],
  resolve: {
    conditions: ["node"],
    alias: {
      "solid-js/web": resolve(sj, "web/dist/server.js"),
      "solid-js/store": resolve(sj, "store/dist/server.js"),
      "solid-js": resolve(sj, "dist/server.js")
    }
  },
  test: {
    environment: "node",
    include: ["server-checks/**/*.test.{ts,tsx}"],
    server: {
      deps: {
        inline: [/solid-js/]
      }
    }
  }
});
