#![cfg(not(feature = "node"))]

use solidjs_compiler::{
    CallbackDecision, CompileOptions, ExecutionSiteKind, Generate, SourceNames, TerminalDecision,
    ValueDecision, compile,
};

fn compare(source: &str, options: CompileOptions) -> solidjs_compiler::SemanticTrace {
    let plain = compile(source, &options).expect("ordinary RC.13 compilation");
    let traced = compile(
        source,
        &CompileOptions {
            semantic_trace: true,
            ..options
        },
    )
    .expect("RC.13 census reconciliation");
    assert_eq!(plain.code, traced.code);
    assert_eq!(plain.source_map, traced.source_map);
    assert_eq!(plain.css, traced.css);
    assert_eq!(plain.css_hash, traced.css_hash);
    traced.semantic_trace.expect("requested trace")
}

#[test]
fn new_effective_options_are_bound_and_output_neutral() {
    let source =
        "const view = <Thing value={value()}><div title={title()}>{child()}</div></Thing>;";
    for generate in [Generate::Dom, Generate::Ssr] {
        for hoist_props in [false, true] {
            for components in [false, true] {
                for bindings in [false, true] {
                    let trace = compare(
                        source,
                        CompileOptions {
                            generate,
                            hoist_props,
                            source_names: SourceNames {
                                components,
                                bindings,
                                locations: false,
                            },
                            source_map: true,
                            ..CompileOptions::default()
                        },
                    );
                    assert_eq!(trace.identity.config.hoist_props, hoist_props);
                    assert_eq!(trace.identity.config.source_names_components, components);
                    assert_eq!(trace.identity.config.source_names_bindings, bindings);
                }
            }
        }
    }
}

#[test]
fn dom_spread_key_is_discarded_but_ssr_tail_key_is_deferred() {
    let source = "const view = <li {...attrs} $key={key()} title={title()} />;";
    for generate in [Generate::Dom, Generate::Ssr] {
        let trace = compare(
            source,
            CompileOptions {
                generate,
                source_map: true,
                ..CompileOptions::default()
            },
        );
        let key = trace
            .sites
            .iter()
            .find(|site| &source[site.span.start as usize..site.span.end as usize] == "key()")
            .expect("exact key site");
        assert_eq!(key.kind, ExecutionSiteKind::NativeAttribute);
        assert_eq!(
            key.decision,
            TerminalDecision::Value(if generate == Generate::Dom {
                ValueDecision::Elided
            } else {
                ValueDecision::SsrRenderCallback
            })
        );
    }
}

#[test]
fn ssr_tail_marks_copied_values_deferred_and_keeps_literals_out_of_the_census() {
    let source = "const view = <div {...attrs} id={name} title={read()} hidden={false} />;";
    let trace = compare(
        source,
        CompileOptions {
            generate: Generate::Ssr,
            source_map: true,
            ..CompileOptions::default()
        },
    );
    for text in ["name", "read()"] {
        let site = trace
            .sites
            .iter()
            .find(|site| &source[site.span.start as usize..site.span.end as usize] == text)
            .expect("exact tail site");
        assert_eq!(
            site.decision,
            TerminalDecision::Value(ValueDecision::SsrRenderCallback)
        );
    }
    assert!(
        trace
            .sites
            .iter()
            .all(|site| &source[site.span.start as usize..site.span.end as usize] != "false")
    );
}

#[test]
fn ssr_class_and_style_holes_reconcile_the_selected_thunk() {
    let source = "const view = <div class={className} style={{ color: read() }} />;";
    let trace = compare(
        source,
        CompileOptions {
            generate: Generate::Ssr,
            source_map: true,
            ..CompileOptions::default()
        },
    );
    assert!(
        trace
            .sites
            .iter()
            .any(|site| &source[site.span.start as usize..site.span.end as usize] == "className")
    );
    assert!(trace.sites.iter().any(|site| &source
        [site.span.start as usize..site.span.end as usize]
        == "{ color: read() }"));
}

#[test]
fn ssr_spread_event_is_elided_and_ref_factory_runs_without_server_component_claims() {
    let source = "const view = <button {...attrs} onClick={handler} ref={factory()} />;";
    let trace = compare(
        source,
        CompileOptions {
            generate: Generate::Ssr,
            source_map: true,
            ..CompileOptions::default()
        },
    );
    for (kind, expected) in [
        (ExecutionSiteKind::EventHandler, CallbackDecision::Elided),
        (ExecutionSiteKind::Ref, CallbackDecision::RefFactoryOnly),
    ] {
        let site = trace
            .sites
            .iter()
            .find(|site| site.kind == kind)
            .expect("exact site");
        assert_eq!(site.decision, TerminalDecision::Callback(expected));
    }
}
