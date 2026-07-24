---
"@solidjs/signals": patch
---

Fix two autodispose leaks in lazy nodes kept alive by the STATUS_PENDING exemption (#2934, #2935). The exemption keeps a lazy node alive when it loses its last subscriber mid-flight, but only the thenable branch's own settle callbacks ran the matching release. Now every path that clears pending state on a subscriber-less lazy node releases it: `settlePendingSource` (derivatively-pending nodes settling by upstream resolution), the error propagation path (upstream rejection), and the AsyncIterable branch — which also stops pulling values once unobserved, closing the iterator via its cleanup instead of pumping the stream forever.
