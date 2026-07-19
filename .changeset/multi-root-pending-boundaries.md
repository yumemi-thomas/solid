---
"solid-js": patch
---

Starting hydration for a second root no longer resets the pending-boundary bookkeeping of an earlier root that is still waiting on a serialized `<Loading>` boundary (#2917). The pending-boundary counter now spans hydration roots: `sharedConfig.done` only flips once every root's boundaries have resumed, instead of a later root's completion draining hydration (and clearing snapshots) out from under an earlier pending root and driving the counter negative when it finally resumed. Each boundary registration now releases its pending count exactly once — via resume, the fallback asset path, or disposal — so a disposed boundary whose promise never settles cannot hold global hydration open.
