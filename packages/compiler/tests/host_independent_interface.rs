//! Public compiler-interface coverage without the Node/N-API adapter.
#![cfg(not(feature = "node"))]

use solidjs_compiler::{
    CompileErrorKind, CompileOptions, ExecutionSiteKind, Generate, TerminalDecision, ValueDecision,
    compile,
};

#[test]
fn compiles_through_the_public_rust_interface() {
    let output = compile(
        "const view = <div>{signal()}</div>;",
        &CompileOptions::default(),
    )
    .expect("compile through the public Rust interface");

    assert!(output.code.contains("template("));
    assert!(output.code.contains("insert("));
}

#[test]
fn supports_every_generate_mode_without_node_types() {
    for generate in [
        Generate::Dom,
        Generate::Ssr,
        Generate::Universal,
        Generate::Dynamic,
    ] {
        compile(
            "const view = <div />;",
            &CompileOptions {
                generate,
                ..CompileOptions::default()
            },
        )
        .unwrap_or_else(|error| panic!("{generate:?}: {error}"));
    }
}

#[test]
fn returns_owned_source_maps_and_typed_errors() {
    let output = compile(
        "const view = <div />;",
        &CompileOptions {
            source_map: true,
            ..CompileOptions::default()
        },
    )
    .expect("compile with a source map");
    assert!(output.source_map.is_some());

    let parse = compile("const view = <", &CompileOptions::default()).unwrap_err();
    assert_eq!(parse.kind(), CompileErrorKind::Parse);

    let configuration = compile(
        "const view = <div />;",
        &CompileOptions {
            module_name: String::new(),
            ..CompileOptions::default()
        },
    )
    .unwrap_err();
    assert_eq!(configuration.kind(), CompileErrorKind::Configuration);
}

fn traced(source: &str) -> solidjs_compiler::SemanticTrace {
    compile(
        source,
        &CompileOptions {
            semantic_trace: true,
            ..CompileOptions::default()
        },
    )
    .expect("semantic tracing should cover valid DOM JSX")
    .semantic_trace
    .expect("semantic trace")
}

#[test]
fn public_core_returns_owned_code_and_typed_semantics() {
    let source = "const view = <div>{signal()}</div>;";
    let output = compile(
        source,
        &CompileOptions {
            semantic_trace: true,
            ..CompileOptions::default()
        },
    )
    .expect("compile through the public Rust interface");

    assert!(output.code.contains("insert"));
    let trace = output.semantic_trace.expect("semantic trace");
    assert_eq!(trace.version, solidjs_compiler::SEMANTIC_TRACE_VERSION);
    assert_eq!(trace.sites.len(), 1);
    assert_eq!(trace.sites[0].kind, ExecutionSiteKind::JsxChild);
    assert_eq!(
        trace.sites[0].decision,
        TerminalDecision::Value(ValueDecision::ReactiveRerun)
    );
    assert_eq!(
        &source[trace.sites[0].span.start as usize..trace.sites[0].span.end as usize],
        "signal()"
    );
}

#[test]
fn semantic_tracing_is_output_neutral() {
    let source = "const view = <div style={{ color: signal() }}>{count()}</div>;";
    let compile_with_trace = |semantic_trace| {
        compile(
            source,
            &CompileOptions {
                semantic_trace,
                source_map: true,
                ..CompileOptions::default()
            },
        )
        .expect("compile with source map")
    };

    let ordinary = compile_with_trace(false);
    let traced = compile_with_trace(true);
    assert_eq!(traced.code, ordinary.code);
    assert_eq!(traced.source_map, ordinary.source_map);
    assert!(ordinary.semantic_trace.is_none());
    assert!(traced.semantic_trace.is_some());
}

#[test]
fn semantic_trace_round_trips_and_rejects_unknown_fields() {
    let trace = traced("const view = <Thing value={signal()} />;");
    let json = serde_json::to_string(&trace).expect("serialize semantic trace");
    let decoded: solidjs_compiler::SemanticTrace =
        serde_json::from_str(&json).expect("deserialize semantic trace");
    assert_eq!(decoded, trace);

    let unknown = serde_json::from_str::<solidjs_compiler::SemanticTrace>(
        r#"{"version":2,"sites":[],"ownership_sites":[],"future":[]}"#,
    );
    assert!(unknown.is_err());
}

#[test]
fn semantic_trace_fails_closed_for_unsupported_or_bypassed_modes() {
    let unsupported = compile(
        "const view = <div />;",
        &CompileOptions {
            generate: Generate::Ssr,
            semantic_trace: true,
            ..CompileOptions::default()
        },
    )
    .unwrap_err();
    assert_eq!(unsupported.kind(), CompileErrorKind::Configuration);

    let bypassed = compile(
        "const view = <div />;",
        &CompileOptions {
            semantic_trace: true,
            require_import_source: Some("other-renderer".into()),
            ..CompileOptions::default()
        },
    )
    .unwrap_err();
    assert_eq!(bypassed.kind(), CompileErrorKind::Configuration);
}
