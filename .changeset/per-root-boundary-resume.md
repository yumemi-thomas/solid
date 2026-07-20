---
"solid-js": patch
---

A `<Loading>` boundary that resumes after another `hydrate()` root has started now claims server DOM against the root it registered under (#2917, follow-up to the pending-boundary counter fix). Boundary registration captures the current root's registry/gather pair via the DOM runtime's `sharedConfig.captureBoundaryScope`, keyed by the full boundary id; the resume path swaps the captured pair in for its synchronous window and restores the globals afterwards, falling back to the live globals when no capture exists. Previously a late resume gathered against the last-hydrated root's container and registry, so the server-streamed fragment went unclaimed and the boundary's reactive bindings attached to orphaned client nodes. Captures are cleaned up when the boundary's pending count releases (resume, fallback asset path, or disposal).
