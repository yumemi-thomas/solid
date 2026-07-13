---
"@solidjs/web": patch
---

Emit `@solidjs/web/storage` types at the advertised path (#2873)

The storage tsbuild used `rootDir: ".."`, so declarations landed at
`storage/types/storage/src/index.d.ts` while package.json advertised
`storage/types/index.d.ts`, breaking consumers of `@solidjs/web/storage`
(e.g. solid-start). The build now resolves `@solidjs/web` against the built
declarations and emits directly to `storage/types/index.d.ts`.
