---
"solid-js": patch
---

Fix streamed SSR infinite loop when async work is created inside an `Errored` boundary (#2809 follow-up). The server error boundary discarded its partial template when children went async and disposed + re-ran them on every retry pull, recreating the async computation (and its fetch) each pass so the render never completed. The boundary now stashes the pending template and resumes its surviving holes across retries, matching how `Loading` already resumes.
