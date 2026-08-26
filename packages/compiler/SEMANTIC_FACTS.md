# Semantic facts fork

This branch is a checker-owned fork of the Solid compiler. Its only permitted
delta from the recorded `solidjs/solid` `next` base is an observational semantic
trace and the tests and dependencies required to validate that trace.

## Boundary

Allowed changes are trace data models, source-site census, output-neutral
recording hooks at existing lowering decisions, reconciliation and deterministic
serialization, a host-independent trace option/result, and facts-only tests.

This branch must not change lowering, emitted JavaScript, source maps,
diagnostics, runtime behavior, compiler features, optimizations, or unrelated
dependencies. A compiler defect is recorded as an open fact limitation; it is
not fixed here. This branch is maintained in the fork and is not proposed as an
upstream pull request.

## Interface

`CompileOptions::semantic_trace` enables trace collection. When enabled, a
successful DOM transform returns `CompileResult::semantic_trace` using semantic
trace format version 2. Unsupported generate modes and import-bypassed DOM
transforms fail closed instead of returning an incomplete trace.

The producer first censuses compiler-controlled source sites independently of
lowering. Lowering must then give every site exactly one terminal disposition.
The trace also reports compiler-established owner relations, component render
sites, and deferred callback sites required by the current solid-checker
adapter. Static-template lowering is speculative, so trace observations are
transactional and are discarded when lowering falls back to a dynamic path.

The trace describes compiler output, not runtime-library semantics. Consumers
must obtain scheduling, cleanup, package, and runtime behavior from other
verified fact domains.

## Required gates

- the complete Rust compiler test suite with default features disabled;
- corpus-wide census reconciliation;
- trace-enabled versus trace-disabled identity for JavaScript, source maps, and
  diagnostics;
- byte-for-byte generated-output comparison with a baseline independently
  generated from the exact upstream base;
- a diff-scope review that rejects non-semantic source changes;
- solid-checker adapter, process, finding-count, ownership, and full verification
  after the checker is pinned to the fork commit.

The exact upstream base and completed gate evidence live in solid-checker's
compiler bootstrap conformance report.
