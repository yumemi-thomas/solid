---
"solid-js": patch
---

Fix `lazy()` hydration crashing when Solid Refresh registers a component in the dynamically imported chunk (#2920). The module-scope `$$component(...)` registration created its bookkeeping signal through the hydration-aware `createSignal`, which requires a reactive owner to consume a hydration child id — at module evaluation time there is none, so `peekNextChildId` threw and hydration fell back to client rendering. Registration signals are dev bookkeeping and never participate in hydration: the component is now stored in a plain-object signal (`createSignal({ current })`), so no hydration-aware computation is created and no hydration child ids are consumed.
