---
"solid-js": patch
---

Loading boundaries whose serialized state is already settled now hydrate straight through to content instead of rendering the fallback for a microtask. The fallback only hydrates when it is actually what the server left showing (i.e. the streamed fragment has not swapped in yet). The phantom fallback pass created detached client DOM and poisoned insert's node bookkeeping, causing async values beside siblings at fragment root to duplicate instead of update on post-hydration refresh (#2801).
