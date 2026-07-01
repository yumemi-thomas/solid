---
"@solidjs/signals": patch
---

Store key-handling fixes, plus a follow-up to the #2797 array-truncation fix:

- **Array truncation notifies tracked reads** (#2768): #2797 clears the truncated indices from `has`/`ownKeys`/index reads; this additionally calls `notifyStoreProperty` for each dropped index, so a reactive read tracking `store[i]` re-runs instead of holding the stale value.
- **Symbol-keyed properties** (#2769): writing a symbol key on an array store threw (`parseInt` on a symbol), and several helper/replacement paths dropped symbol keys because they enumerated with `Object.keys`. Array writes now treat symbols as metadata (not indices), and `storeSetter`, `storePath`, and `merge`/`omit` enumerate own enumerable keys including symbols.
- **Null-prototype objects** (#2771): reading a function-valued property off an `Object.create(null)` store crashed (`storeValue.hasOwnProperty` is undefined). The check now uses `Object.prototype.hasOwnProperty.call`.
