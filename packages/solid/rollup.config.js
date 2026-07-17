import nodeResolve from "@rollup/plugin-node-resolve";
import babel from "@rollup/plugin-babel";
import cleanup from "rollup-plugin-cleanup";
import replace from "@rollup/plugin-replace";

const plugins = [
  nodeResolve({
    extensions: [".js", ".ts"]
  }),
  babel({
    extensions: [".js", ".ts"],
    exclude: "node_modules/**",
    babelrc: false,
    babelHelpers: "bundled",
    presets: ["@babel/preset-typescript"]
  }),
  cleanup({
    comments: ["some", /PURE/],
    extensions: [".js", ".ts"]
  })
];

const replaceDev = isDev =>
  replace({
    '"_SOLID_DEV_"': isDev,
    preventAssignment: true,
    delimiters: ["", ""]
  });

export default [
  {
    input: "src/index.ts",
    output: [
      {
        file: "dist/solid.cjs",
        format: "cjs"
      },
      {
        file: "dist/solid.js",
        format: "es"
      }
    ],
    external: ["@solidjs/signals"],
    plugins: [replaceDev(false)].concat(plugins)
  },
  {
    input: "src/server/index.ts",
    output: [
      {
        file: "dist/server.cjs",
        format: "cjs"
      },
      {
        file: "dist/server.js",
        format: "es"
      }
    ],
    external: ["@solidjs/signals", "stream"],
    plugins
  },
  {
    input: "src/index.ts",
    output: [
      {
        file: "dist/dev.cjs",
        format: "cjs"
      },
      {
        file: "dist/dev.js",
        format: "es"
      }
    ],
    external: ["@solidjs/signals"],
    plugins: [replaceDev(true)].concat(plugins)
  },
  // The refresh runtime imports the main entry ("solid-js") rather than
  // relative sources so it shares module state ($DEVCOMP, DEV) with the
  // solid-js instance the app resolves at build time.
  {
    input: "src/refresh/index.ts",
    output: [
      {
        file: "dist/refresh.cjs",
        format: "cjs"
      },
      {
        file: "dist/refresh.js",
        format: "es"
      }
    ],
    external: ["solid-js", "@solidjs/signals"],
    plugins: [replaceDev(false)].concat(plugins)
  },
  {
    input: "src/refresh/index.ts",
    output: [
      {
        file: "dist/refresh.dev.cjs",
        format: "cjs"
      },
      {
        file: "dist/refresh.dev.js",
        format: "es"
      }
    ],
    external: ["solid-js", "@solidjs/signals"],
    plugins: [replaceDev(true)].concat(plugins)
  }
];
