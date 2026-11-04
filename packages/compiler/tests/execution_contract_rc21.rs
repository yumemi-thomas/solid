#![cfg(not(feature = "node"))]

//! Semantic facts at the lowering paths published Solid RC.21 changed: a lone
//! dynamic SSR spread defers behind the thunk the multi-source path uses.

use solidjs_compiler::{
    CompileOptions, ExecutionDisposition, ExecutionSiteKind, Generate, compile,
};

fn spread_disposition(source: &str) -> ExecutionDisposition {
    let options = CompileOptions {
        generate: Generate::Ssr,
        ..CompileOptions::default()
    };
    let plain = compile(source, &options).expect("ordinary RC.21 compilation");
    let traced = compile(
        source,
        &CompileOptions {
            semantic_trace: true,
            ..options
        },
    )
    .expect("RC.21 census reconciliation");
    assert_eq!(plain.code, traced.code);
    let trace = traced.semantic_trace.expect("requested trace");
    trace
        .sites
        .iter()
        .find(|site| site.kind == ExecutionSiteKind::NativeSpread)
        .expect("a native spread site")
        .semantics
        .disposition
}

#[test]
fn a_lone_dynamic_spread_records_the_thunk_it_lowers_to() {
    assert_eq!(
        spread_disposition("const view = <div {...read()} />;"),
        ExecutionDisposition::SsrRenderCallback
    );
    assert_eq!(
        spread_disposition("const view = <div {...read()} title={title} />;"),
        ExecutionDisposition::SsrRenderCallback
    );
}

#[test]
fn a_lone_static_spread_stays_an_evaluation() {
    assert_eq!(
        spread_disposition("const view = <div {...props} />;"),
        ExecutionDisposition::SsrEvaluation
    );
}

#[test]
fn compile_program_refuses_tracing() {
    use oxc_allocator::Allocator;
    use oxc_parser::Parser;
    use oxc_span::SourceType;
    let allocator = Allocator::default();
    let source = "const view = <div />;";
    let program = Parser::new(&allocator, source, SourceType::jsx())
        .parse()
        .program;
    let options = CompileOptions {
        semantic_trace: true,
        ..CompileOptions::default()
    };
    let error = solidjs_compiler::compile_program(&allocator, program, source, &options)
        .expect_err("tracing is refused");
    assert!(error.to_string().contains("semantic tracing"));
}
