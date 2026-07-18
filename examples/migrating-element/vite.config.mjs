import { defineConfig } from "vite";
// Exercises the current vite-plugin-solid pipeline: native JSX compiler by
// default, native lazy/refresh passes, solid-js/refresh HMR runtime.
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid()],
  server: { port: 3003 },
  preview: { port: 3003 }
});
