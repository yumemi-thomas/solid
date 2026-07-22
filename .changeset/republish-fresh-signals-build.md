---
"@solidjs/signals": patch
---

Republish with fresh build artifacts: the `2.0.0-beta.23` tarball of
`@solidjs/signals` was packed from a stale local build and is missing the
`snapshot()` derived-store-view unwrap fix that its own changelog claims.
No source changes; this release exists so the published artifacts match
the source at the tag.
