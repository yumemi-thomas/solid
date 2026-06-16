---
"@solidjs/signals": patch
"solid-js": patch
---

Fix store type inference for arrays and projection seeds.

- `createStore`/`createOptimisticStore` plain forms inferred array literals as
  fixed-length tuples (the `NoFn<T> | Store<NoFn<T>>` union biased inference to
  tuples), so the setter wrongly rejected length changes like
  `set(l => l.filter(...))` or `set(reconcile(shorterArray, "id"))`. The initial
  value is now typed `NoFn<T>` (plain value) so array literals infer as `T[]`.
- `createProjection` seed is now typed `Partial<T> | Store<NoFn<T>>` (matching the
  `createStore`/`createOptimisticStore` projection overloads). A readonly store
  seed infers the full `T` instead of shadowing the projection function's return
  type (the goal of solidjs/solid#2786), while a partial/empty seed (`{}`, `[]`)
  is still allowed — you don't have to restate the shape `fn` already declares.
