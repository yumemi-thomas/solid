---
"@solidjs/signals": patch
---

Fix `reconcile()` never notifying symbol-keyed store nodes (#2851)

The remaining variant of #2769: reconcile's diff loops enumerated with
`Object.keys`, so symbol-keyed nodes were never diffed — tracked reads and
`in` checks of `state[SYM]` were not notified, and the stale node shadowed
the reconciled value even for untracked reads. Symbol keys are now diffed
like string keys: `getAllKeys` appends enumerable symbols (with override
deletes still winning), and node-record loops enumerate symbols only for
records that currently hold a user symbol node (tracked via a WeakSet mark
maintained by `getNode`/`unobserved`), keeping the symbol-free hot path on
`Object.keys`.
