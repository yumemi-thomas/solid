---
"@solidjs/web": patch
---

Fix the frames types build: `types:copy-frames` expected compiled declarations at `frames/types/` that no step ever generated, breaking `pnpm types` (and CI builds). Frames declarations now compile via a dedicated `frames/tsconfig.build.json` (mirroring the storage submodule), and the published `types/frames` facades get their bundled `@dom-expressions/runtime` specifiers rewritten to relative paths so they resolve against the runtime d.ts files shipped alongside them.
