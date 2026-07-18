import { defineConfig } from "vite";
// vite-plugin-solid is TEMPORARILY linked to the sibling checkout (see
// pnpm-workspace.yaml) to dogfood the current pipeline: native JSX compiler
// by default, native lazy/refresh passes, solid-js/refresh HMR runtime.
import solid from "vite-plugin-solid";

export default defineConfig({
  root: import.meta.dirname,
  publicDir: "../shared/static",
  plugins: [solid()],
  server: { port: 3000 },
  preview: { port: 3000 }
});
