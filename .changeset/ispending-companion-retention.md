---
"@solidjs/signals": patch
---

Fix `isPending(() => latest(x))` in a user effect looping the scheduler on the
first write after the async source settles ("Potential Infinite Loop Detected"
in dev, an unbounded spin in prod). The pending-flag companion signal is
written optimistically, so an ambient transition completing reverted its `true`
override while the async it reports on was still in flight. The revert
re-notified the subscribed effect, which re-armed the write forever, and
`isPending` never read `true`.

Companion signals for `latest()` shadows now carry a revert-deferral policy:
transition completion waits while the companion's reported source
(parent/firewall) is still in-flight, then lets the normal optimistic reversion
path clear the override once that source settles or is disposed.

The regression coverage includes async memos, store-leaf `latest()` reads, and
multiple watchers of the same source.
