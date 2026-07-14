// Bridge entry like src/client.ts / server/server.ts: rollup bundles the
// runtime implementation through this specifier (seroval stays external).
// There is no tsc pass for this entry — the types build copies the runtime's
// serializer.d.ts to serialization/types/index.d.ts (types:copy-serialization)
// so published types never reference @dom-expressions/runtime.
export * from "@dom-expressions/runtime/src/serializer.js";
