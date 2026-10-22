#![cfg(not(feature = "node"))]

//! Semantic facts at the lowering paths published Solid RC.17 added or
//! changed: lowercase `on*` attributes, nullable SSR class/style holes, SSR
//! spread-element and template ref evaluation, anchor link claims, valueless
//! `prop:` attributes, removed 1.x namespaces, the removed server-components
//! option, and the unbound `sourceNames.locations` configuration.

use solidjs_compiler::{
    CallbackDecision, CompileOptions, ExecutionCardinality, ExecutionDisposition,
    ExecutionSchedule, ExecutionSemantics, ExecutionSiteKind, ExecutionTrigger, Generate,
    OwnerRelation, SemanticTrace, SourceNames, TerminalDecision, ValueDecision, compile,
};

fn compare(source: &str, options: CompileOptions) -> SemanticTrace {
    let plain = compile(source, &options).expect("ordinary RC.17 compilation");
    let traced = compile(
        source,
        &CompileOptions {
            semantic_trace: true,
            ..options
        },
    )
    .expect("RC.17 census reconciliation");
    assert_eq!(plain.code, traced.code);
    assert_eq!(plain.source_map, traced.source_map);
    assert_eq!(plain.css, traced.css);
    assert_eq!(plain.css_hash, traced.css_hash);
    traced.semantic_trace.expect("requested trace")
}

fn options(generate: Generate) -> CompileOptions {
    CompileOptions {
        generate,
        source_map: true,
        ..CompileOptions::default()
    }
}

fn site<'t>(
    trace: &'t SemanticTrace,
    source: &str,
    text: &str,
) -> &'t solidjs_compiler::ExecutionSite {
    trace
        .sites
        .iter()
        .find(|site| &source[site.span.start as usize..site.span.end as usize] == text)
        .unwrap_or_else(|| panic!("exact site {text:?}"))
}

#[test]
fn lowercase_on_attributes_are_values_not_event_handlers() {
    for (source, spread) in [
        (
            "const view = <div onclick={handler} onClick={click} />;",
            false,
        ),
        (
            "const view = <div {...attrs} onclick={handler} onClick={click} />;",
            true,
        ),
    ] {
        for generate in [Generate::Dom, Generate::Ssr] {
            let trace = compare(source, options(generate));
            let lowercase = site(&trace, source, "handler");
            assert_eq!(
                lowercase.kind,
                ExecutionSiteKind::NativeAttribute,
                "{source}"
            );
            assert!(
                matches!(lowercase.decision, TerminalDecision::Value(_)),
                "{source}: {:?}",
                lowercase.decision
            );
            let event = site(&trace, source, "click");
            assert_eq!(event.kind, ExecutionSiteKind::EventHandler, "{source}");
            let expected = match (generate, spread) {
                (Generate::Dom, _) => CallbackDecision::LaterEvent,
                _ => CallbackDecision::Elided,
            };
            assert_eq!(
                event.decision,
                TerminalDecision::Callback(expected),
                "{source}"
            );
        }
    }
}

#[test]
fn ssr_nullable_class_and_style_holes_follow_the_thunk_decision() {
    let source = "const view = <div class={cls()} style={css} title={title()} />;";
    let trace = compare(source, options(Generate::Ssr));
    assert_eq!(
        site(&trace, source, "cls()").decision,
        TerminalDecision::Value(ValueDecision::SsrRenderCallback)
    );
    assert_eq!(
        site(&trace, source, "css").decision,
        TerminalDecision::Value(ValueDecision::SsrEvaluation)
    );
    assert!(trace.deferred_callback_sites.iter().any(|deferred| &source
        [deferred.span.start as usize..deferred.span.end as usize]
        == "cls()"));
}

#[test]
fn ssr_link_claim_anchors_keep_attribute_decisions() {
    for source in [
        "const view = <a href={url()} rel=\"noopener\">x</a>;",
        "const view = <a href={url} target={target()}>x</a>;",
        "const view = <a href={`/p/${id()}`}>x</a>;",
        "const view = <a {...attrs} href={url()} title={title()}>x</a>;",
    ] {
        let trace = compare(source, options(Generate::Ssr));
        let mut found = 0;
        for text in ["url()", "url", "target()", "`/p/${id()}`", "title()"] {
            if let Some(site) = trace
                .sites
                .iter()
                .find(|site| &source[site.span.start as usize..site.span.end as usize] == text)
            {
                let expected = if text == "url" {
                    ValueDecision::SsrEvaluation
                } else {
                    ValueDecision::SsrRenderCallback
                };
                assert_eq!(
                    site.decision,
                    TerminalDecision::Value(expected),
                    "{source}: {text}"
                );
                found += 1;
            }
        }
        assert!(found >= 1, "{source}: no link attribute site");
    }
}

#[test]
fn ssr_template_ref_factory_is_unchanged() {
    let source = "const view = <div ref={tip()} />;";
    let trace = compare(source, options(Generate::Ssr));
    assert_eq!(
        site(&trace, source, "tip()").decision,
        TerminalDecision::Callback(CallbackDecision::RefFactoryOnly)
    );
}

fn ref_semantics(
    trace: &SemanticTrace,
    source: &str,
    text: &str,
) -> (TerminalDecision, ExecutionSemantics) {
    let site = site(trace, source, text);
    assert_eq!(site.kind, ExecutionSiteKind::Ref, "{source}: {text}");
    (site.decision, site.semantics.clone())
}

/// The template path hoists every non-literal ref as `_ref$N = <expr>`, so
/// a ref whose evaluation can run code is a ref-factory evaluation, once,
/// inline. A binding read, `this`, or a function never runs code there.
#[test]
fn ssr_template_refs_that_evaluate_are_recorded_as_evaluated() {
    let evaluated = TerminalDecision::Callback(CallbackDecision::RefFactoryOnly);
    let elided = TerminalDecision::Callback(CallbackDecision::Elided);
    for (source, text, expected, emitted) in [
        (
            "const view = <div ref={[tip(), el]} />;",
            "[tip(), el]",
            evaluated,
            "var _ref$ = [tip(), el];",
        ),
        (
            "const view = <div ref={cond ? f() : g} />;",
            "cond ? f() : g",
            evaluated,
            "var _ref$ = cond ? f() : g;",
        ),
        (
            "function C(props) { return <div ref={props.ref} />; }",
            "props.ref",
            evaluated,
            "var _ref$ = props.ref;",
        ),
        (
            "const view = <div ref={a?.b} title={t()} />;",
            "a?.b",
            evaluated,
            "var _ref$ = a?.b",
        ),
        (
            "const view = <For each={xs}>{(x) => <div ref={x.ref} />}</For>;",
            "x.ref",
            evaluated,
            "_ref$ = x.ref",
        ),
        (
            "const view = <div ref={`a${b}`} />;",
            "`a${b}`",
            evaluated,
            "var _ref$ = `a${b}`;",
        ),
        (
            "const view = <div ref={tip()} />;",
            "tip()",
            evaluated,
            "var _ref$ = tip();",
        ),
        (
            "let el; const view = <div ref={el} />;",
            "el",
            elided,
            "var _ref$ = el;",
        ),
        (
            "let el; const view = <div ref={el!} />;",
            "el!",
            elided,
            "var _ref$ = el!;",
        ),
        (
            "let x; const view = <div ref={(el) => (x = el)} />;",
            "(el) => (x = el)",
            elided,
            "var _ref$ = (el) => x = el;",
        ),
    ] {
        let settings = CompileOptions {
            built_ins: vec!["For".into()],
            ..options(Generate::Ssr)
        };
        let output = compile(source, &settings).expect("ordinary RC.17 compilation");
        assert!(output.code.contains(emitted), "{source}\n{}", output.code);
        let trace = compare(source, settings);
        let (decision, semantics) = ref_semantics(&trace, source, text);
        assert_eq!(decision, expected, "{source}");
        if expected == evaluated {
            assert_eq!(semantics.disposition, ExecutionDisposition::RefFactory);
            assert_eq!(semantics.trigger, ExecutionTrigger::Render);
            assert_eq!(semantics.schedule, ExecutionSchedule::Inline);
            assert_eq!(semantics.cardinality, ExecutionCardinality::ExactlyOnce);
            assert_eq!(semantics.owner, OwnerRelation::AmbientAtTransformSite);
        } else {
            assert_eq!(semantics.disposition, ExecutionDisposition::Discarded);
            assert_eq!(semantics.cardinality, ExecutionCardinality::Never);
        }
    }
}

/// A hole-free element in an already-escaped child position is emitted as
/// its bare template string; the hoisted `_ref$N` declarations are dropped
/// with it, so none of its refs run. A template with a hole keeps them.
#[test]
fn ssr_dropped_template_refs_are_elided() {
    let evaluated = TerminalDecision::Callback(CallbackDecision::RefFactoryOnly);
    let elided = TerminalDecision::Callback(CallbackDecision::Elided);
    for (source, expected) in [
        (
            "const view = <section>{cond() && <div ref={tip()} />}</section>;",
            vec![("tip()", elided)],
        ),
        (
            "const view = <section>{<div ref={tip()}><span ref={props.ref} /></div>}</section>;",
            vec![("tip()", elided), ("props.ref", elided)],
        ),
        (
            "const view = <section>{<div ref={tip()} />}<div ref={g()} /></section>;",
            vec![("tip()", elided), ("g()", evaluated)],
        ),
        (
            "const view = <section>{<div ref={tip()}>{x()}</div>}</section>;",
            vec![("tip()", evaluated)],
        ),
        (
            "const view = <section>{[<div ref={tip()} />]}</section>;",
            vec![("tip()", evaluated)],
        ),
    ] {
        let output = compile(source, &options(Generate::Ssr)).expect("ordinary compilation");
        let calls = expected
            .iter()
            .filter(|(_, decision)| *decision == evaluated)
            .count();
        assert_eq!(
            output.code.matches("_ref$").count() > 0,
            calls > 0,
            "{source}\n{}",
            output.code
        );
        let trace = compare(source, options(Generate::Ssr));
        for (text, decision) in expected {
            assert_eq!(
                ref_semantics(&trace, source, text).0,
                decision,
                "{source}: {text}"
            );
        }
        // The child hole that returns the static markup still runs.
        assert!(
            trace
                .sites
                .iter()
                .filter(|site| site.kind == ExecutionSiteKind::JsxChild)
                .all(|site| site.decision != TerminalDecision::Value(ValueDecision::Elided)),
            "{source}"
        );
    }
}

/// The spread-element path evaluates only refs that call something; its
/// decisions do not move with the template path.
#[test]
fn ssr_spread_element_ref_decisions_are_unchanged() {
    for (source, text, expected) in [
        (
            "const view = <div {...attrs} ref={props.ref} />;",
            "props.ref",
            CallbackDecision::Elided,
        ),
        (
            "const view = <div {...attrs} ref={cond ? f : g} />;",
            "cond ? f : g",
            CallbackDecision::Elided,
        ),
        (
            "const view = <div {...attrs} ref={[tip(), el]} />;",
            "[tip(), el]",
            CallbackDecision::RefFactoryOnly,
        ),
        (
            "const view = <div {...attrs} ref={cond ? f() : g} />;",
            "cond ? f() : g",
            CallbackDecision::RefFactoryOnly,
        ),
    ] {
        let trace = compare(source, options(Generate::Ssr));
        assert_eq!(
            ref_semantics(&trace, source, text).0,
            TerminalDecision::Callback(expected),
            "{source}"
        );
    }
}

#[test]
fn dom_claimed_anchor_and_stateful_inputs_keep_attribute_decisions() {
    for dev in [false, true] {
        for source in [
            "const view = <a href={url()}>x</a>;",
            "const view = <a href=\"/x\" title={title()}>x</a>;",
            "const view = <input type=\"checkbox\" value={value()} />;",
            "const view = <select value={value()}><option /></select>;",
        ] {
            let trace = compare(
                source,
                CompileOptions {
                    dev,
                    ..options(Generate::Dom)
                },
            );
            assert!(
                trace
                    .sites
                    .iter()
                    .any(|site| site.kind == ExecutionSiteKind::NativeAttribute
                        && site.decision == TerminalDecision::Value(ValueDecision::ReactiveRerun)),
                "{source}"
            );
        }
    }
}

#[test]
fn valueless_prop_attribute_has_no_source_site() {
    let source = "const view = <input prop:indeterminate />;";
    for generate in [Generate::Dom, Generate::Ssr] {
        let trace = compare(source, options(generate));
        assert!(trace.sites.is_empty(), "{:?}", trace.sites);
    }
}

#[test]
fn removed_namespaces_reject_identically_with_and_without_tracing() {
    for source in [
        "const view = <div use:tip={value} />;",
        "const view = <div on:click={handler} />;",
        "const view = <div classList={{ a: b() }} />;",
    ] {
        for generate in [Generate::Dom, Generate::Ssr] {
            let plain = compile(source, &options(generate)).expect_err("removed form");
            let traced = compile(
                source,
                &CompileOptions {
                    semantic_trace: true,
                    ..options(generate)
                },
            )
            .expect_err("removed form");
            assert_eq!(plain.to_string(), traced.to_string());
        }
    }
}

#[test]
fn removed_server_components_option_is_bound_as_disabled() {
    let source = "const view = <div title={title()} />;";
    for generate in [Generate::Dom, Generate::Ssr] {
        let trace = compare(source, options(generate));
        assert!(!trace.identity.config.server_components);
    }
}

#[test]
fn source_name_locations_are_refused_until_bound_by_identity() {
    let source = "const view = <Thing value={value()} />;";
    for generate in [Generate::Dom, Generate::Ssr] {
        let settings = CompileOptions {
            filename: Some("src/App.tsx".into()),
            source_names: SourceNames {
                components: true,
                bindings: true,
                locations: true,
            },
            ..options(generate)
        };
        compile(source, &settings).expect("ordinary located compilation");
        let error = compile(
            source,
            &CompileOptions {
                semantic_trace: true,
                ..settings
            },
        )
        .expect_err("locations are not in the trace identity");
        assert!(
            error.to_string().contains("sourceNames.locations"),
            "{error}"
        );
    }
}
