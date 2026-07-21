// The whole build, no Vite: the native @dom-expressions/compiler runs the
// `use server` directive pass and the JSX transform per target, wrapped in
// a ~30-line esbuild plugin. Two bundles from one source tree — the client
// gets reference proxies where server functions were (server-component
// bodies and their JSX never reach the browser); the server gets the
// registered functions compiled for SSR.
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { transform, transformDirectives } from "@dom-expressions/compiler";

const root = path.dirname(fileURLToPath(import.meta.url));
const web = p => path.resolve(root, "../../packages/solid-web", p);

const solid = mode => ({
  name: "solid-native",
  setup(b) {
    b.onLoad({ filter: /src[\\/][^\\/]+\.jsx$/ }, async args => {
      let code = await readFile(args.path, "utf8");
      const filename = path.relative(root, args.path);
      const directives = transformDirectives(code, {
        filename,
        root,
        mode,
        env: "production",
        register: { source: "@solidjs/web/server-functions/server", name: "registerServerReference" },
        // References resolve per build: the server build calls in-process
        // (the server module's createServerReference), the client fetches.
        create: {
          source:
            mode === "server"
              ? "@solidjs/web/server-functions/server"
              : "@solidjs/web/server-functions/client",
          name: "createServerReference"
        }
      });
      if (directives.valid) code = directives.code;
      code = transform(code, {
        filename,
        generate: mode === "server" ? "ssr" : "dom",
        hydratable: true,
        moduleName: "@solidjs/web"
      }).code;
      return { contents: code, loader: "js" };
    });
  }
});

// Pre-facade wiring: @solidjs/web has no ./frames dist entry yet, and each
// bundle must hold exactly ONE runtime instance (the frames transport
// configures the server-function client it shares a module with) — so the
// subpaths route through the package's source bridges.
const alias = {
  "@solidjs/web/frames/server": web("frames/src/server.ts"),
  "@solidjs/web/frames": web("frames/src/client.ts"),
  "@solidjs/web/server-functions/server": web("server-functions/src/server.ts"),
  "@solidjs/web/server-functions/client": web("server-functions/src/client.ts"),
  "@solidjs/web/storage": web("storage/src/index.ts"),
  // dom-expressions' reactive-core seam, bound to Solid's core (same as
  // solid-web's own builds).
  rxcore: web("src/core.ts")
};

await build({
  entryPoints: [path.resolve(root, "src/entry-client.jsx")],
  outfile: path.resolve(root, "dist/client.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  conditions: ["browser"],
  alias: { ...alias, "@solidjs/web": web("src/index.ts") },
  plugins: [solid("client")],
  // Minified: this example demos wire/bundle claims, so the served artifact
  // is the honest one (string literals survive — the README grep test still
  // works; use the sourcemap to read it).
  minify: true,
  sourcemap: true,
  logLevel: "info"
});

await build({
  entryPoints: [path.resolve(root, "src/entry-server.jsx")],
  outfile: path.resolve(root, "dist/server.js"),
  bundle: true,
  format: "esm",
  platform: "node",
  conditions: ["node"],
  alias: { ...alias, "@solidjs/web": web("server/index.ts") },
  plugins: [solid("server")],
  sourcemap: true,
  logLevel: "info"
});
