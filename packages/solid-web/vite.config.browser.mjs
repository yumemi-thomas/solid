/// <reference types="vitest" />

// Real-browser (Chromium via Playwright) test project. Unlike the jsdom configs,
// this runs against a real engine with layout, a real `document.startViewTransition`
// and real pseudo-element animations — the only way to exercise the gesture
// view-transition behaviour (scrub, commit/cancel finalisation, focus/caret
// restoration, `:active-view-transition-type()` CSS) that jsdom mocks away.
//
// Like `vite.config.mjs`, it resolves `@solidjs/web` through the package's
// `development`/`browser` export condition (i.e. the built `dist/dev.js`), so a
// `build` must precede `pnpm test:browser`. The `test:browser` script clears the
// `.vite` dep cache first (`rimraf node_modules/.vite`) so a fresh rebuild is
// always picked up — otherwise a previously-bundled `dist` in the vitest dep
// cache would mask src changes.

import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import solidPlugin from "vite-plugin-solid";
import { resolve } from "path";

const rootDir = resolve(__dirname);

export default defineConfig({
  plugins: [solidPlugin()],
  test: {
    include: ["test/browser/**/*.spec.tsx"],
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      screenshotFailures: false,
      instances: [{ browser: "chromium" }]
    }
  },
  resolve: {
    conditions: ["development", "browser"],
    alias: {
      rxcore: [resolve(rootDir, "../../packages/solid-web/src/core")]
    }
  }
});
