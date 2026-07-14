---
"@solidjs/web": minor
---

Add the `@solidjs/web/serialization` subpath exposing the runtime's Seroval serialization primitives: `createSerializer`, `DEFAULT_WEB_PLUGINS`, and `resolveSerializerPlugins` for the shared web plugin configuration, plus the isomorphic JSON codec (`serializeJSON` / `createJSONDeserializer`) for RPC-style transports such as server functions. The entry is opt-in — browser bundles only include it when imported, like `@solidjs/web/storage`. The seroval dependency floor moves to `~1.5.4` (1.5.3 and earlier carry a security issue; the codec also relies on `depthLimit` support).
