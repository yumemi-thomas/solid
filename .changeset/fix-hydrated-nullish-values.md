---
"solid-js": patch
---

Fix hydration of nullish serialized values (#2914). A settled serialization ref `{ s: 1, v: null }` previously hydrated to the internal ref object instead of `null`, and a directly serialized `null`/`undefined` was treated as "no server value", running the client compute instead of adopting it. The unwrap now reads the ref payload directly and presence is decided by `sharedConfig.has` rather than nullish-checking the loaded value.
