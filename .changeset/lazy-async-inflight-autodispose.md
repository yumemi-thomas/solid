---
"solid-js": patch
---

Lazy memos with an in-flight async computation no longer autodispose when
their last subscriber momentarily drops (e.g. a consumer disposing
mid-request): the pending work counts as an observer, so a later subscriber
attaches to the same computation instead of re-executing the source — one
server fetch per suspended re-read, not one per churn. Settling while
unobserved still releases the node (normal lazy teardown resumes once
idle).
