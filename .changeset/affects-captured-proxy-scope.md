---
"@solidjs/signals": patch
---

Rebuild `affects()` on the status rails so marks propagate through derivation (#2882). A live mark now pushes `STATUS_PENDING` downstream from the marked node exactly like real in-flight async — memos and effects DERIVED from marked data read pending too, not just direct reads of the marked slot — under a dedicated sentinel pending-source per marked node, so the two channels can't clear each other: a landing on the marked node settles only its own source entry, a quiet `refresh()` re-ask can't silence the declared window (the sentinel is never a re-ask), and a mark never blocks its own transaction's settlement (release happens AT settle). Computeds that recompute mid-window re-acquire the mark through the read path.

This also fixes keyless marks not covering captured store proxies (`<For>` rows): a keyless declaration walks the marked record's subtree (through write overlays), registers on every live node in it, snapshots the reachable raw identities, and nodes created during the window inherit the mark at birth from that scope. Records added after the declaration are not covered (snapshot-at-declaration semantics).
