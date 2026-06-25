---
"solid-js": patch
---

fix(server): serialize chained async memo values resolved after a nested Loading boundary commits

A chained async memo reached through a synchronous derived memo (e.g. `a` async → `m = createMemo(() => a()[0])` → `b = createMemo(() => fetchItems(m()))`) resolves only after its dependency, so inside a nested `<Loading>` boundary it serializes *after* the surrounding boundary has already flushed and committed. That late serialization landed in a buffer that never flushed again, so the value was dropped — only the dependency's value survived. On the client the memo then re-ran its compute and orphaned the server-streamed fragment ("Hydration completed with N unclaimed server-rendered node(s)"). This is the shape produced when route content is nested in a root layout's boundary (e.g. TanStack Start).

Once a boundary has flushed, later serializations now write through to the parent context instead of being buffered into a buffer that will never flush again.
