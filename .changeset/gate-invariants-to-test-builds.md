---
"@solidjs/signals": patch
---

Gate the async/transition invariant assertions behind `__TEST__` instead of `__DEV__`. The per-write tracking and per-flush quiescence sweep regressed dev-build performance by 5-21% across the benchmark suite; dev builds now pay nothing for them and they run only under the test suite's defines.
