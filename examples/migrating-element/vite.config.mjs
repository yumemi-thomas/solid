import { defineConfig } from "vite";
// vite-plugin-solid is TEMPORARILY linked to the sibling checkout (see
// pnpm-workspace.yaml) to dogfood the current pipeline: native JSX compiler
// by default, native lazy/refresh passes, solid-js/refresh HMR runtime.
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid()],
  server: { port: 3003 },
  preview: { port: 3003 }
});
