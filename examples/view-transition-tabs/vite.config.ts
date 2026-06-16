import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";

const repo = (path: string) => fileURLToPath(new URL(`../../${path}`, import.meta.url));

export default defineConfig({
  plugins: [tailwindcss(), solid()],
  resolve: {
    conditions: ["development", "browser", "import"],
    alias: {
      rxcore: repo("packages/solid-web/src/core"),
      "@solidjs/web/jsx-runtime": repo("packages/solid-web/src/index.ts"),
      "@solidjs/web/jsx-dev-runtime": repo("packages/solid-web/src/index.ts"),
      "@solidjs/web": repo("packages/solid-web/src/index.ts"),
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
});
