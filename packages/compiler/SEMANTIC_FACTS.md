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

## 2026-10-03 published RC.13 update

The upstream base is the published `2.0.0-rc.13` Git head
`5efaf260becb32293f2bcb4d32f8be72be6de674`. The merge preserves its lowering,
diagnostics, source maps, SSR props hoisting, source-name labels, ref ordering,
server-function export validation and TSRX frontend. Later unreleased `next`
commits are outside this candidate.

Trace v3 now binds `hoist_props`, `source_names_components` and
`source_names_bindings` in its effective configuration. Recording covers the
DOM spread `$key` discard, deferred SSR spread tails, conditional server
component ref/event claims and server component class/style holes. Claims
do not assert that an event or ref executes on the server.

The corpus contains 95 fixture sources and 270 probes. Its test reader uses
the JavaScript parser's cooked template-literal value, including escaped
backslashes and quotes. The 365-entry output baseline comes from untouched
RC.13. Independent upstream/fork and published-native comparisons cover nine
profiles (3,285 outcomes): code, maps, CSS fields and diagnostics match;
tracing preserves all DOM/SSR outcomes. Universal, Dynamic and authored TSRX
fact recording remain refused. Generated operations retain partial enumeration.

Rust validation passes 53 tests without default features, 116 with only TSRX,
and 63 with default features. The baseline writer remains ignored. Strict
all-feature Clippy inherits RC.13's `collapsible_if` in shared/validate.rs and
`if_same_then_else` in tsrx/project.rs; excluding only those two named lints
passes. The same strict failures occur in untouched upstream.

Checker production pins and its full identity, process, coverage, ownership,
contract and verification gates must migrate together before adoption. This
local compiler candidate alone does not certify package behavior or feedback
accuracy. Evidence and the reproducible patch are recorded in solid-checker's
`benchmarks/compiler-facts/rc13/` and the dated RC.13 rebase report.

## 2026-10-22 published RC.17 port

The upstream base is the published `2.0.0-rc.17` Git head and `next` tip
`5b1b777648a89b6e207e8bb78514d5c03420e08b`. The facts delta is applied as
linear commits on that base, not merged into the RC.13 branch. Upstream
lowering, diagnostics, source maps and the TSRX frontend are kept unchanged.

Upstream removed the server-components option. Trace v3 keeps
`server_components` in its configuration as an explicit `false`, as it does
for `patch_driver`, and the claim recording is gone with the lowering it
observed. Only `on` plus an uppercase letter is an event now (Babel's
`isEventName`). The census and DOM spread recording use the same predicate,
so a lowercase `onclick` is a native attribute value. SSR's nullable
`class`/`style` hole records the thunk decision it emits. Anchor link claims
and their `_lv$` temps keep the attribute decision of the hole they read. A
spread element's named `ref` is recorded as `ref-factory-only` when
`ssrElement`'s markup thunk evaluates it, which happens when the expression
calls something; otherwise it is recorded as elided. Removed 1.x namespaces
reject the same way whether tracing is on or off. A valueless `prop:` has no
source site. `sourceNames.locations` (and the `root` it reads) is not bound
by the trace identity, so tracing refuses that configuration.

The corpus contains 101 fixture sources and 272 probes. The 373-entry output
baseline was generated from untouched RC.17. Eleven DOM/SSR profiles (4,103
outcomes) match upstream byte for byte in code, maps, CSS fields and
diagnostics, and tracing preserves every outcome. Strict no-default-feature
all-target Clippy passes. No inherited upstream lint needs an exclusion,
because RC.17 removed the `collapsible_if` in shared/validate.rs.

### SSR template refs

The template path hoists every non-literal `ref` as `_ref$N = <expr>`,
evaluated once inline where the template is finalized. A ref expression whose
evaluation can run code (a call, a member or optional-chain read that can hit
a getter, an array, a conditional, a template literal with substitutions, any
other compound expression) is recorded as `ref-factory-only`. A binding read,
`this`, a literal, or a function or arrow expression (its body never runs on
the server), including under parentheses and TypeScript wrappers, stays
elided. A hole-free element in an already-escaped child position is emitted as
its bare template string and its `_ref$N` declarations are dropped, so its
refs are recorded as elided; any other execution claim inside such a template
refuses the trace. The spread-element path is unchanged.
A `ref-factory-only` evaluation records inherited tracking on both paths: the
output places it in a module or component body, a component `children`
getter, a control-flow or render callback, or `ssrElement`'s markup thunk,
and establishes no untracked scope for any of them (SSR components are plain
calls).
