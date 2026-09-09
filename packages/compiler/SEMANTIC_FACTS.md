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
successful JSX DOM or SSR transform returns `CompileOutput::semantic_trace`
using semantic trace format version 3. Unsupported generate modes and
import-bypassed transforms fail closed instead of returning an incomplete trace.
TSRX tracing also fails closed: the frontend's generated program is not yet
mapped to authored source sites by the semantic census. Ordinary TSRX compilation
continues to use upstream behavior when tracing is disabled.

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

## 2026-09-09 upstream update

The branch incorporates upstream `91088d2c2b867492c173b0e45f8b40cbe8390b1b`.
Its compiler directory has Git tree identity
`cca039e412e51483e98fb3953525da70316b1712`, identical to the compiler directory
at the published RC.7 artifact's recorded git head
`b1c4399ef726397581374bd9378d9e4596c83dba`.

The port retains upstream's TSRX frontend, removed patch mode, tag-aware
attribute classification and SSR component-child depth behavior. The trace-v3
`patch_driver` identity field is retained with the value `disabled`; the fork
does not restore the removed compiler option. SSR's lone-spread fast path now
records the native refs that upstream discards before returning the spread.

The JSX comparison corpus contains 92 fixture sources and 263 adversarial
probes. Upstream added five probes and removed eight obsolete patch-mode probes.
An independent runner compared 2,840 upstream/fork outcomes across eight
profiles, including generated JavaScript, source maps, CSS result fields and
errors, with no differences. The replacement 355-entry transform baseline was
generated from untouched upstream, not from this fork. These checks do not
establish TSRX semantic tracing or checker finding parity after a pin move.

Validation completed with Rust 1.97: 48 tests without default features, 63
default-feature tests, and 110 tests with only the TSRX feature enabled passed.
The deliberate baseline writer remains ignored. The JavaScript suite passed
5,348 tests, with 28 upstream skips. Strict all-target/all-feature Clippy reports
the same `collapsible_if` at `src/shared/validate.rs:101` as untouched upstream;
with that single lint excluded, the remaining Clippy checks pass. Formatting
checks retain upstream differences in `refresh/transform.rs` and
`universal/transform.rs`. This fork does not modify those upstream branches
merely to make a style gate green.
