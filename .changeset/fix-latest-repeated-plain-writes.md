---
"@solidjs/signals": patch
---

`latest()` on a memo now recomputes after every unflushed write instead of freezing at the first speculative value (#2922). Two staleness holes closed: the heap's mark memo (`_marked`) is only reset by a flush, so a plain write landing between two mid-tick pulls left its subscribers unmarked and every later pull stale; and an untracked `latest()` read has no reading context, so `read()` never performed its mid-tick pull on a still-subscribed shadow. Writes now invalidate the mark memo when an unmarked node enters a marked heap, and the latest() read path pulls its shadow up to date (and surfaces the shadow's held speculative value) before answering.
