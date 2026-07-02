---
"solid-js": patch
---

Server render effects now respect `defer: true` — the compute still runs for parity, but the initial side-effect run is skipped like on the client (#2811)
