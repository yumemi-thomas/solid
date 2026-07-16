// Bridge entry like ../../src/client.ts: rollup bundles the runtime
// implementation through this specifier (seroval stays external). The types
// build copies the runtime's server-functions d.ts files into
// types/server-functions/ so published types never reference
// @dom-expressions.
export * from "@dom-expressions/runtime/src/server-functions/client.js";
