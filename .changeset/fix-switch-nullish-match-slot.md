---
"solid-js": patch
---

Fix `<Switch>` crashing (and halting the reactive system) when a child resolves to a nullish value, e.g. a `<Match>` gated behind a false `<Show>` (#2911). Nullish child slots are now skipped during match selection on both client and server, matching the existing tolerance for boolean children.
