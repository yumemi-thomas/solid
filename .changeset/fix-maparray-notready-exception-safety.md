---
"@solidjs/signals": patch
---

Make `mapArray` and `repeat` exception-safe under NotReadyError (#2903). A map callback reading a pending async source aborts the pass mid-diff; passes now stage all work (new rows into temp arrays, removals deferred) and commit only after every mapper succeeds, so an aborted pass disposes exactly the owners it created and leaves prior state intact for the post-settle retry. Previously an aborted pass corrupted the internal diff state — duplicated/lost rows, wrong-owner disposals, and leaked partial owners. `repeat` also gains the `_parentComputed` hookup so async reads in its callbacks suspend and retry correctly. Removed rows now dispose at commit (after the pass's new rows are created).
