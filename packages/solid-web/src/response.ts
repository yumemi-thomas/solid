// Bridge entry like src/client.ts: rollup bundles the runtime implementation
// through this specifier. There is no tsc output kept for this file — the
// types build copies the runtime's response.d.ts over types/response.d.ts
// (types:copy-web) so published types never reference @dom-expressions.
export * from "@dom-expressions/runtime/src/response.js";
