//! Solid's Oxc JSX compiler.
//!
//! The crate exposes two surfaces: the Node/N-API `transform()` interface
//! (behind the default `node` feature) that `@solidjs/compiler`
//! ships, and a host-independent Rust [`compile`] API for embedding the
//! compiler directly.
//!
//! # Stability
//!
//! The Rust API (`compile`, [`CompileOptions`], [`CompileOutput`],
//! [`CompileError`]) is **unstable**. The compiler is pre-1.0 and under
//! active development; this surface carries no semver commitment and may
//! change shape in any release while the compiler churns. Pin an exact
//! revision when embedding it. The Node `transform()` interface remains the
//! supported public contract.

mod compiler;
#[cfg(feature = "node")]
mod config;
#[cfg(feature = "node")]
mod directives;
mod dom;
mod error;
#[cfg(feature = "node")]
mod lazy;
#[cfg(feature = "node")]
mod node_adapter;
#[cfg(feature = "node")]
mod refresh;
mod semantic_trace;
mod shared;
mod ssr;
mod universal;

pub use compiler::{CompileOptions, CompileOutput, Generate, Renderer, Wrapper, compile};
pub use error::{CompileError, CompileErrorKind};
pub use semantic_trace::{
    CallbackDecision, ComponentRenderSite, DeferredCallbackSite, ExecutionCardinality,
    ExecutionDisposition, ExecutionSchedule, ExecutionSemantics, ExecutionSite, ExecutionSiteKind,
    ExecutionTrigger, GeneratedOperation, GeneratedOperationKind, OwnerEstablishment,
    OwnerRelation, OwnershipDecision, OwnershipSite, SEMANTIC_TRACE_IMPLEMENTATION_REVISION,
    SEMANTIC_TRACE_UPSTREAM_REVISION, SEMANTIC_TRACE_VERSION, SemanticCompilerIdentity,
    SemanticRendererConfig, SemanticTrace, SemanticTraceConfig, SemanticTraceIdentity,
    SemanticTraceMode, ServerFunctionImportConfig, ServerFunctionOperation, ServerFunctionScope,
    ServerFunctionSemanticTrace, ServerFunctionTraceConfig, ServerFunctionTraceIdentity,
    ServerFunctionTransformEnv, ServerFunctionTransformMode, SourceSpan, TerminalDecision,
    TrackingRelation, ValueDecision,
};

/// Cargo package version of the compiler implementation producing semantic
/// traces. Consumers should pair this with the trace semantics revision.
pub const COMPILER_VERSION: &str = env!("CARGO_PKG_VERSION");

#[cfg(feature = "node")]
pub use node_adapter::*;
