---
"solid-js": patch
---

Stop pending async reads in server effects from throwing through the render. An effect compute reading a not-yet-ready async source previously propagated `NotReadyError` out of the effect, forcing the surrounding `Loading` boundary to rebuild its whole subtree on every settle — re-creating the async work each time in an infinite discovery loop (#2801). Now render effects register the pending source with the stream (holding flush like top-level JSX async) and retry once it settles so the effect function runs with the resolved value, matching how render effects drive boundaries on the client. Plain `createEffect` is swallowed outright — it never impacts boundaries even on the client.
