---
"solid-js": patch
---

Redesign SSR asset handling for `lazy()` around hydration ids instead of module specifiers.

- The server now keys the streamed module map by the hydration id of the lazy render memo, and the client looks preloaded modules up by computing the same id positionally. Module identity no longer needs to exist client-side, so bundler `moduleUrl` injection is only required on the server.
- New glob support: when a `lazy()` callsite has no static import specifier (e.g. `lazy(globModules[path])` over `import.meta.glob`), the server defers asset resolution until the import settles and reads the module's bundler-injected `$$moduleUrl` export. Assets still attribute to the boundary that rendered the component. Rendering without any resolvable identity now warns (late client load) instead of throwing.
- `Component.moduleUrl` on the server is now a getter that resolves through the active request's asset manifest, returning the client-loadable entry URL (e.g. `/assets/About-abc123.js`) for stamping into markup (islands and similar). Reading it during SSR also registers modulepreload hints for the module's chunks — the only preload signal for lazy components under `NoHydration`. Outside a request context it returns the raw specifier.
