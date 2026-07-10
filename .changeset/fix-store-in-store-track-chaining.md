---
"@solidjs/signals": patch
---

Fix structural tracking through store-in-store wrapper views (#2864). A derived store returning another store creates a wrapper proxy whose $TRACK self-node is separate from the wrapped source's, so structural notifications (reconcile, key adds/deletes) never reached consumers subscribed through the wrapper — `<For>`/`mapArray`, `Object.keys`, `snapshot`/`deep`. An optimistic row could therefore survive in a `<For>` after the refreshed data landed. `trackSelf` now chains the wrapper's $TRACK read through to the wrapped source, except while an override layer holds on the view (the overlay owns the shown structure; the reveal notifies the view's own self-node and re-establishes the chain).
