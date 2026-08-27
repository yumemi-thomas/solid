use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use oxc_ast::ast::{
    JSXAttributeItem, JSXAttributeName, JSXAttributeValue, JSXChild, JSXElement, JSXExpression,
    JSXFragment, Program,
};
use oxc_ast_visit::Visit;
use oxc_span::{GetSpan, Span};

/// Version of the typed semantic-trace schema.
pub const SEMANTIC_TRACE_VERSION: u32 = 3;

/// Exact upstream revision whose compiler behavior this semantic-only branch
/// observes. The fork may add facts, but it may not change that behavior.
pub const SEMANTIC_TRACE_UPSTREAM_REVISION: &str = "a10cf1a147209d885f148396068175ab2f0a996a";

/// Revision containing the trace-v3 semantic implementation. This is filled
/// with the first semantic implementation commit before the distribution pin
/// is cut; the following identity-only commit does not change lowering or the
/// meaning of any fact.
pub const SEMANTIC_TRACE_IMPLEMENTATION_REVISION: &str = "e91bc2ae7fd0e9653db093b1ab74a09c9482042e";

use crate::shared::attr_plan::static_style_key;
use crate::shared::bindings::BindingTable;
use crate::shared::utils::{
    dedupe_attributes, is_component_name, is_literal_only_expression, is_void_element,
};

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SourceSpan {
    pub start: u32,
    pub end: u32,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum SemanticTraceMode {
    Dom,
    Ssr,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SemanticCompilerIdentity {
    pub package_version: String,
    pub upstream_revision: String,
    pub implementation_revision: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SemanticTraceConfig {
    pub filename: Option<String>,
    pub module_name: String,
    pub mode: SemanticTraceMode,
    pub hydratable: bool,
    pub server_components: bool,
    pub dev: bool,
    pub source_map: bool,
    pub context_to_custom_elements: bool,
    pub delegate_events: bool,
    pub delegated_events: Vec<String>,
    pub omit_quotes: bool,
    pub omit_attribute_spacing: bool,
    pub inline_styles: bool,
    pub effect_wrapper: String,
    pub wrap_conditionals: bool,
    pub memo_wrapper: String,
    pub patch_driver: String,
    pub static_marker: String,
    pub require_import_source: Option<String>,
    pub validate: bool,
    pub omit_nested_closing_tags: bool,
    pub omit_last_closing_tag: bool,
    pub built_ins: Vec<String>,
    pub renderers: Vec<SemanticRendererConfig>,
}

#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SemanticRendererConfig {
    pub name: String,
    pub module_name: Option<String>,
    pub elements: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SemanticTraceIdentity {
    pub compiler: SemanticCompilerIdentity,
    pub source_sha256: String,
    pub output_sha256: String,
    pub source_map_sha256: Option<String>,
    pub config: SemanticTraceConfig,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ExecutionDisposition {
    Unknown,
    Discarded,
    EagerOnce,
    Deferred,
    ReactiveRerun,
    EventTriggered,
    RefFactory,
    RefApplication,
    ComponentPropertyGetter,
    ControlFlowRender,
    SsrEvaluation,
    SsrRenderCallback,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ExecutionTrigger {
    Unknown,
    None,
    Render,
    Dependency,
    Event,
    RefApplication,
    Caller,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ExecutionSchedule {
    Unknown,
    None,
    Inline,
    Render,
    Deferred,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum TrackingRelation {
    Unknown,
    None,
    Tracked,
    Untracked,
    Inherited,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ExecutionCardinality {
    Never,
    ZeroOrOne,
    ExactlyOnce,
    ZeroOrMore,
    OneOrMore,
    Unknown,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum OwnerRelation {
    None,
    AmbientAtTransformSite,
    AmbientAtGeneratedInvocation,
    CapturedGeneratedOwner,
    CreatedGeneratedOwner,
    Unknown,
}

#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ExecutionSemantics {
    pub disposition: ExecutionDisposition,
    pub trigger: ExecutionTrigger,
    pub schedule: ExecutionSchedule,
    pub tracking: TrackingRelation,
    pub cardinality: ExecutionCardinality,
    pub owner: OwnerRelation,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub generated_operations: Vec<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum GeneratedOperationKind {
    Effect,
    Insert,
    Memo,
    Scope,
    ComponentInvocation,
    DeferredCallback,
    DelegatedEvent,
    RefApplication,
    SsrClaim,
    RuntimeWrapper,
}

#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(deny_unknown_fields)]
pub struct GeneratedOperation {
    pub id: String,
    pub source_id: String,
    pub source_span: SourceSpan,
    pub kind: GeneratedOperationKind,
    pub trigger: ExecutionTrigger,
    pub schedule: ExecutionSchedule,
    pub tracking: TrackingRelation,
    pub cardinality: ExecutionCardinality,
    pub owner: OwnerRelation,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub receiver_span: Option<SourceSpan>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group_id: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub wrapper: Option<String>,
}

impl From<Span> for SourceSpan {
    fn from(span: Span) -> Self {
        Self {
            start: span.start,
            end: span.end,
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ExecutionSiteKind {
    JsxChild,
    NativeAttribute,
    NativeSpread,
    ComponentProperty,
    ComponentSpread,
    ComponentChild,
    EventHandler,
    Ref,
    ControlFlowRender,
}

impl ExecutionSiteKind {
    fn is_value(self) -> bool {
        matches!(
            self,
            Self::JsxChild
                | Self::NativeAttribute
                | Self::NativeSpread
                | Self::ComponentProperty
                | Self::ComponentSpread
                | Self::ComponentChild
        )
    }

    fn name(self) -> &'static str {
        match self {
            Self::JsxChild => "jsx-child",
            Self::NativeAttribute => "native-attribute",
            Self::NativeSpread => "native-spread",
            Self::ComponentProperty => "component-property",
            Self::ComponentSpread => "component-spread",
            Self::ComponentChild => "component-child",
            Self::EventHandler => "event-handler",
            Self::Ref => "ref",
            Self::ControlFlowRender => "control-flow-render",
        }
    }
}

impl GeneratedOperationKind {
    fn name(self) -> &'static str {
        match self {
            Self::Effect => "effect",
            Self::Insert => "insert",
            Self::Memo => "memo",
            Self::Scope => "scope",
            Self::ComponentInvocation => "component-invocation",
            Self::DeferredCallback => "deferred-callback",
            Self::DelegatedEvent => "delegated-event",
            Self::RefApplication => "ref-application",
            Self::SsrClaim => "ssr-claim",
            Self::RuntimeWrapper => "runtime-wrapper",
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ValueDecision {
    EagerOnce,
    ReactiveRerun,
    CallerContext,
    Elided,
    SsrEvaluation,
    SsrRenderCallback,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum CallbackDecision {
    Elided,
    LaterEvent,
    LaterRender,
    RefApply,
    RefFactoryOnly,
    ConditionalEventClaim,
    ConditionalRefClaim,
    ConditionalRefFactoryClaim,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TerminalDecision {
    Value(ValueDecision),
    Callback(CallbackDecision),
}

#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ExecutionSite {
    pub id: String,
    pub span: SourceSpan,
    pub kind: ExecutionSiteKind,
    pub decision: TerminalDecision,
    pub semantics: ExecutionSemantics,
}

/// Reactive owner state established by compiler-generated lowering around a
/// source region. The trace reports only states the compiler proves; absence
/// means the surrounding runtime or caller determines ownership.
#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum OwnershipDecision {
    Owned,
    Unowned,
    Leaf,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(deny_unknown_fields)]
pub struct OwnershipSite {
    pub span: SourceSpan,
    pub decision: OwnershipDecision,
}

/// Experimental facts about how JSX source values and callbacks are lowered
/// and executed in DOM mode.
#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(deny_unknown_fields)]
pub struct OwnerEstablishment {
    pub span: SourceSpan,
    pub wrapper: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group_id: Option<u64>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ComponentRenderSite {
    pub span: SourceSpan,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(deny_unknown_fields)]
pub struct DeferredCallbackSite {
    pub span: SourceSpan,
    pub receiver_span: SourceSpan,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SemanticTrace {
    pub version: u32,
    pub identity: SemanticTraceIdentity,
    pub sites: Vec<ExecutionSite>,
    pub ownership_sites: Vec<OwnershipSite>,
    #[serde(default)]
    pub owner_establishments: Vec<OwnerEstablishment>,
    #[serde(default)]
    pub component_render_sites: Vec<ComponentRenderSite>,
    #[serde(default)]
    pub deferred_callback_sites: Vec<DeferredCallbackSite>,
    pub generated_operations: Vec<GeneratedOperation>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ServerFunctionTransformMode {
    Client,
    Server,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ServerFunctionTransformEnv {
    Development,
    Production,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ServerFunctionScope {
    Function,
    Module,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ServerFunctionImportConfig {
    pub kind: String,
    pub name: String,
    pub source: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ServerFunctionTraceConfig {
    pub filename: String,
    pub root: Option<String>,
    pub mode: ServerFunctionTransformMode,
    pub env: ServerFunctionTransformEnv,
    pub directive: String,
    pub source_map: bool,
    pub register: ServerFunctionImportConfig,
    pub create: ServerFunctionImportConfig,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ServerFunctionTraceIdentity {
    pub compiler: SemanticCompilerIdentity,
    pub source_sha256: String,
    pub output_sha256: String,
    pub source_map_sha256: Option<String>,
    pub config: ServerFunctionTraceConfig,
}

#[derive(Clone, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ServerFunctionOperation {
    pub id: String,
    pub name: String,
    pub exports: Vec<String>,
    pub source_span: SourceSpan,
    pub directive_span: SourceSpan,
    pub scope: ServerFunctionScope,
    pub boundary: String,
    pub creates_reference: bool,
    pub registers_server_implementation: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ServerFunctionSemanticTrace {
    pub version: u32,
    pub identity: ServerFunctionTraceIdentity,
    pub functions: Vec<ServerFunctionOperation>,
}

impl ValueDecision {
    #[must_use]
    pub const fn name(self) -> &'static str {
        match self {
            Self::EagerOnce => "eager-once",
            Self::ReactiveRerun => "reactive-rerun",
            Self::CallerContext => "caller-context",
            Self::Elided => "elided",
            Self::SsrEvaluation => "ssr-evaluation",
            Self::SsrRenderCallback => "ssr-render-callback",
        }
    }
}

impl CallbackDecision {
    #[must_use]
    pub const fn name(self) -> &'static str {
        match self {
            Self::Elided => "elided",
            Self::LaterEvent => "later-event",
            Self::LaterRender => "later-render",
            Self::RefApply => "ref-apply",
            Self::RefFactoryOnly => "ref-factory-only",
            Self::ConditionalEventClaim => "conditional-event-claim",
            Self::ConditionalRefClaim => "conditional-ref-claim",
            Self::ConditionalRefFactoryClaim => "conditional-ref-factory-claim",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
struct SiteKey {
    span: SourceSpan,
    kind: ExecutionSiteKind,
}

#[derive(Clone)]
pub(crate) struct ExecutionCensus {
    sites: BTreeSet<SiteKey>,
    ignored_literal_spans: BTreeSet<SourceSpan>,
    ref_factory_spans: BTreeSet<SourceSpan>,
    mode: SemanticTraceMode,
}

impl ExecutionCensus {
    pub(crate) fn from_program(
        program: &Program<'_>,
        built_ins: &[String],
        inline_styles: bool,
        mode: SemanticTraceMode,
    ) -> Self {
        let mut bindings = BindingTable::default();
        bindings.scan_builtin_shadowing(program, built_ins);

        struct CensusVisitor<'a, 'bindings> {
            sites: BTreeSet<SiteKey>,
            ignored_literal_spans: BTreeSet<SourceSpan>,
            component_child_fragments: BTreeSet<SourceSpan>,
            /// Void native elements whose child list survives into DOM
            /// lowering. See [`Self::mark_nested_void_children`].
            nested_void_elements: BTreeSet<SourceSpan>,
            ref_factory_spans: BTreeSet<SourceSpan>,
            built_ins: HashSet<&'a str>,
            bindings: &'bindings BindingTable,
            inline_styles: bool,
            mode: SemanticTraceMode,
        }

        impl CensusVisitor<'_, '_> {
            fn push(&mut self, span: Span, kind: ExecutionSiteKind) {
                if span.start < span.end {
                    self.sites.insert(SiteKey {
                        span: span.into(),
                        kind,
                    });
                }
            }

            fn ignore_literal(&mut self, span: Span) {
                if span.start < span.end {
                    self.ignored_literal_spans.insert(span.into());
                }
            }

            fn attribute_name(name: &JSXAttributeName<'_>) -> String {
                match name {
                    JSXAttributeName::Identifier(name) => name.name.to_string(),
                    JSXAttributeName::NamespacedName(name) => {
                        format!("{}:{}", name.namespace.name, name.name.name)
                    }
                }
            }

            fn stateful_dynamic_key(
                tag_name: Option<&str>,
                name: &str,
                value: &JSXExpression<'_>,
            ) -> Option<String> {
                let expression = value.as_expression()?;
                if tag_name.is_none() || is_literal_only_expression(expression) {
                    return None;
                }
                let tag_name = tag_name?.to_ascii_uppercase();
                let stateful = match tag_name.as_str() {
                    "INPUT" => matches!(
                        name,
                        "value"
                            | "defaultValue"
                            | "checked"
                            | "defaultChecked"
                            | "prop:value"
                            | "prop:defaultValue"
                            | "prop:checked"
                            | "prop:defaultChecked"
                    ),
                    "SELECT" => matches!(name, "value" | "prop:value"),
                    "OPTION" => matches!(
                        name,
                        "value"
                            | "selected"
                            | "defaultSelected"
                            | "prop:value"
                            | "prop:selected"
                            | "prop:defaultSelected"
                    ),
                    "TEXTAREA" => matches!(
                        name,
                        "value" | "defaultValue" | "prop:value" | "prop:defaultValue"
                    ),
                    "VIDEO" | "AUDIO" => matches!(
                        name,
                        "muted" | "defaultMuted" | "prop:muted" | "prop:defaultMuted"
                    ),
                    _ => false,
                };
                stateful.then(|| {
                    if name.starts_with("prop:") {
                        name.to_string()
                    } else {
                        format!("prop:{name}")
                    }
                })
            }

            fn native_tag_name<'node, 'ast>(
                element: &'node JSXElement<'ast>,
            ) -> Option<&'node str> {
                match &element.opening_element.name {
                    oxc_ast::ast::JSXElementName::Identifier(name) => Some(name.name.as_str()),
                    oxc_ast::ast::JSXElementName::IdentifierReference(name) => {
                        Some(name.name.as_str())
                    }
                    _ => None,
                }
            }

            fn class_object_splits(object: &oxc_ast::ast::ObjectExpression<'_>) -> bool {
                object.properties.iter().all(|property| match property {
                    oxc_ast::ast::ObjectPropertyKind::SpreadProperty(_) => false,
                    oxc_ast::ast::ObjectPropertyKind::ObjectProperty(property) => {
                        if property.computed {
                            return false;
                        }
                        match &property.key {
                            oxc_ast::ast::PropertyKey::StringLiteral(key) => {
                                !key.value.contains(' ') && !key.value.contains(':')
                            }
                            _ => true,
                        }
                    }
                })
            }

            fn split_class_array_object<'node, 'ast>(
                expression: &'node oxc_ast::ast::Expression<'ast>,
            ) -> Option<&'node oxc_ast::ast::ObjectExpression<'ast>> {
                let oxc_ast::ast::Expression::ArrayExpression(array) = expression else {
                    return None;
                };
                let mut static_classes = Vec::new();
                let mut cursor = 0;
                while let Some(oxc_ast::ast::ArrayExpressionElement::StringLiteral(value)) =
                    array.elements.get(cursor)
                {
                    static_classes.push(value.value.to_string());
                    cursor += 1;
                }
                if static_classes.is_empty() || cursor != array.elements.len().checked_sub(1)? {
                    return None;
                }
                let Some(oxc_ast::ast::ArrayExpressionElement::ObjectExpression(object)) =
                    array.elements.get(cursor)
                else {
                    return None;
                };
                let static_class_set: HashSet<String> = static_classes
                    .iter()
                    .flat_map(|class| class.split_whitespace().map(str::to_string))
                    .collect();
                let conflicting = object.properties.iter().any(|property| match property {
                    oxc_ast::ast::ObjectPropertyKind::SpreadProperty(_) => true,
                    oxc_ast::ast::ObjectPropertyKind::ObjectProperty(property) => {
                        if property.computed {
                            return true;
                        }
                        static_style_key(&property.key).is_none_or(|key| {
                            key.contains(' ')
                                || key.contains(':')
                                || static_class_set.contains(&key)
                        })
                    }
                });
                (!conflicting).then_some(object)
            }

            fn mark_component_child_fragments(&mut self, children: &[JSXChild<'_>]) {
                for child in children {
                    if let JSXChild::Fragment(fragment) = child {
                        self.component_child_fragments.insert(fragment.span.into());
                    }
                }
            }

            /// Record which void children of a *native* element keep their own
            /// children through lowering.
            ///
            /// A void element's child list survives exactly when the element is
            /// lowered as a nested native child: `lower_dynamic_native_child`
            /// walks into `lower_dom_children` unconditionally, so
            /// `<div><br>{x()}</br></div>` emits a real reactive
            /// `insert(_el$2, x)` into the `<br>`. Every other position makes
            /// the void element a template root of its own — a bare JSX root, a
            /// fragment child, a component child, an attribute value — and
            /// `lower_dom_element` gates child lowering on `!is_void_element`,
            /// so the child list is discarded with no code emitted.
            ///
            /// Only a native parent marks: a component's children and a
            /// fragment's children each become their own template root.
            fn mark_nested_void_children(&mut self, children: &[JSXChild<'_>]) {
                for child in children {
                    if let JSXChild::Element(child) = child
                        && let Some(tag) = Self::native_tag_name(child)
                        && !is_component_name(&child.opening_element.name)
                        && is_void_element(tag)
                    {
                        self.nested_void_elements.insert(child.span.into());
                    }
                }
            }

            fn census_children(&mut self, children: &[JSXChild<'_>], component: bool) {
                for child in children {
                    match child {
                        JSXChild::ExpressionContainer(container)
                            if !matches!(
                                container.expression,
                                JSXExpression::EmptyExpression(_)
                            ) =>
                        {
                            if container
                                .expression
                                .as_expression()
                                .is_some_and(is_literal_only_expression)
                            {
                                self.ignore_literal(container.expression.span());
                                continue;
                            }
                            self.push(
                                container.expression.span(),
                                if component {
                                    ExecutionSiteKind::ComponentChild
                                } else {
                                    ExecutionSiteKind::JsxChild
                                },
                            );
                        }
                        JSXChild::Spread(spread) => self.push(
                            spread.expression.span(),
                            if component {
                                ExecutionSiteKind::ComponentChild
                            } else {
                                ExecutionSiteKind::JsxChild
                            },
                        ),
                        _ => {}
                    }
                }
            }

            fn child_list_span(children: &[JSXChild<'_>]) -> Option<Span> {
                let first = children.first()?;
                let last = children.last()?;
                Some(Span::new(first.span().start, last.span().end))
            }
        }

        impl<'b> Visit<'b> for CensusVisitor<'_, '_> {
            fn visit_jsx_element(&mut self, element: &JSXElement<'b>) {
                let component = is_component_name(&element.opening_element.name);
                let native_tag_name = (!component)
                    .then(|| Self::native_tag_name(element))
                    .flatten();
                let has_spread = element
                    .opening_element
                    .attributes
                    .iter()
                    .any(|attribute| matches!(attribute, JSXAttributeItem::SpreadAttribute(_)));
                let control_flow = match &element.opening_element.name {
                    oxc_ast::ast::JSXElementName::IdentifierReference(name) => {
                        self.built_ins.contains(name.name.as_str())
                            && !self.bindings.is_builtin_shadowed(name.span)
                    }
                    _ => false,
                };

                let attributes = if component {
                    element
                        .opening_element
                        .attributes
                        .iter()
                        .collect::<Vec<_>>()
                } else {
                    dedupe_attributes(&element.opening_element.attributes)
                };
                let mut last_stateful = HashMap::new();
                for item in &attributes {
                    let JSXAttributeItem::Attribute(attribute) = item else {
                        continue;
                    };
                    let Some(JSXAttributeValue::ExpressionContainer(container)) = &attribute.value
                    else {
                        continue;
                    };
                    let name = Self::attribute_name(&attribute.name);
                    if let Some(key) =
                        Self::stateful_dynamic_key(native_tag_name, &name, &container.expression)
                    {
                        last_stateful.insert(key, attribute.span);
                    }
                }
                for item in attributes {
                    match item {
                        JSXAttributeItem::SpreadAttribute(spread) => self.push(
                            spread.argument.span(),
                            if component {
                                ExecutionSiteKind::ComponentSpread
                            } else {
                                ExecutionSiteKind::NativeSpread
                            },
                        ),
                        JSXAttributeItem::Attribute(attribute) => {
                            let name = Self::attribute_name(&attribute.name);
                            if !component
                                && name == "children"
                                && let Some(JSXAttributeValue::StringLiteral(value)) =
                                    &attribute.value
                            {
                                // Upstream `bba3db6c` promotes an
                                // unbraced string attribute into a synthesized
                                // JSX expression container. Child lowering
                                // consequently records at the original string
                                // span, but literal-only values are not
                                // execution sites. Remember the span so that
                                // recording remains a no-op, exactly as for a
                                // braced literal child.
                                self.ignore_literal(value.span);
                                continue;
                            }
                            let Some(JSXAttributeValue::ExpressionContainer(container)) =
                                &attribute.value
                            else {
                                continue;
                            };
                            if matches!(container.expression, JSXExpression::EmptyExpression(_)) {
                                continue;
                            }
                            if !component
                                && Self::stateful_dynamic_key(
                                    native_tag_name,
                                    &name,
                                    &container.expression,
                                )
                                .is_some_and(|key| last_stateful.get(&key) != Some(&attribute.span))
                            {
                                continue;
                            }
                            if container
                                .expression
                                .as_expression()
                                .is_some_and(is_literal_only_expression)
                            {
                                self.ignore_literal(container.expression.span());
                                continue;
                            }
                            if !component && name == "_hk" {
                                continue;
                            }
                            if !component
                                && name == "xmlns"
                                && native_tag_name.is_some_and(|tag| {
                                    tag == "svg"
                                        || tag == "math"
                                        || crate::shared::constants::svg_elements(tag)
                                        || crate::shared::constants::mathml_elements(tag)
                                })
                            {
                                continue;
                            }
                            if !component
                                && !has_spread
                                && self.mode == SemanticTraceMode::Dom
                                && (name == "class" || (name == "style" && self.inline_styles))
                                && let Some(oxc_ast::ast::Expression::ObjectExpression(object)) =
                                    container.expression.as_expression()
                            {
                                let has_spread = object.properties.iter().any(|property| {
                                    matches!(
                                        property,
                                        oxc_ast::ast::ObjectPropertyKind::SpreadProperty(_)
                                    )
                                });
                                let decomposes = if name == "class" {
                                    Self::class_object_splits(object)
                                } else {
                                    !has_spread
                                };
                                if decomposes {
                                    if name == "style"
                                        && object.properties.iter().any(|property| {
                                            matches!(
                                                property,
                                                oxc_ast::ast::ObjectPropertyKind::ObjectProperty(property)
                                                    if property.computed
                                            )
                                        })
                                    {
                                        self.push(
                                            container.expression.span(),
                                            ExecutionSiteKind::NativeAttribute,
                                        );
                                    }
                                    for property in &object.properties {
                                        let oxc_ast::ast::ObjectPropertyKind::ObjectProperty(
                                            property,
                                        ) = property
                                        else {
                                            unreachable!("fixed object checked above");
                                        };
                                        if property.computed {
                                            continue;
                                        }
                                        if is_literal_only_expression(&property.value) {
                                            continue;
                                        }
                                        self.push(
                                            property.value.span(),
                                            ExecutionSiteKind::NativeAttribute,
                                        );
                                    }
                                    continue;
                                }
                            }
                            if !component
                                && !has_spread
                                && self.mode == SemanticTraceMode::Dom
                                && name == "class"
                                && let Some(expression) = container.expression.as_expression()
                                && let Some(object) = Self::split_class_array_object(expression)
                            {
                                for property in &object.properties {
                                    let oxc_ast::ast::ObjectPropertyKind::ObjectProperty(property) =
                                        property
                                    else {
                                        unreachable!("split class array is fixed");
                                    };
                                    if !is_literal_only_expression(&property.value) {
                                        self.push(
                                            property.value.span(),
                                            ExecutionSiteKind::NativeAttribute,
                                        );
                                    }
                                }
                            }
                            let kind = if name == "ref" {
                                if matches!(
                                    container.expression.as_expression(),
                                    Some(oxc_ast::ast::Expression::CallExpression(_))
                                ) {
                                    self.ref_factory_spans
                                        .insert(container.expression.span().into());
                                }
                                ExecutionSiteKind::Ref
                            } else if !component && name.starts_with("on") {
                                ExecutionSiteKind::EventHandler
                            // `children` is promoted to a child insert only
                            // where lowering promotes it: `lower_dom_element`
                            // gates the capture on `!is_void_element`, so on a
                            // void element the value stays an attribute (and,
                            // as in Babel, emits nothing at all).
                            } else if !component
                                && name == "children"
                                && !native_tag_name.is_some_and(is_void_element)
                                && (has_spread || element.children.is_empty())
                            {
                                ExecutionSiteKind::JsxChild
                            } else if component {
                                ExecutionSiteKind::ComponentProperty
                            } else {
                                ExecutionSiteKind::NativeAttribute
                            };
                            self.push(container.expression.span(), kind);
                        }
                    }
                }

                // A void native element that is a template root discards its
                // child list before the 2.0 lowering pass reaches it; do not
                // census expressions the emitter never resolves. A void element
                // in *nested* native-child position keeps them — see
                // `mark_nested_void_children` — so it censuses like any other
                // native element. Attributes are censused either way above:
                // they are not children, and lowering emits them for both
                // shapes.
                if native_tag_name.is_some_and(is_void_element)
                    && !self
                        .nested_void_elements
                        .contains(&SourceSpan::from(element.span))
                {
                    if let Some(span) = Self::child_list_span(&element.children) {
                        self.push(span, ExecutionSiteKind::JsxChild);
                    }
                    oxc_ast_visit::walk::walk_jsx_opening_element(self, &element.opening_element);
                    return;
                }
                if !component && self.mode == SemanticTraceMode::Dom {
                    self.mark_nested_void_children(&element.children);
                }
                for child in &element.children {
                    match child {
                        JSXChild::ExpressionContainer(container)
                            if !matches!(
                                container.expression,
                                JSXExpression::EmptyExpression(_)
                            ) =>
                        {
                            if container
                                .expression
                                .as_expression()
                                .is_some_and(is_literal_only_expression)
                            {
                                self.ignore_literal(container.expression.span());
                                continue;
                            }
                            let function = matches!(
                                container.expression,
                                JSXExpression::ArrowFunctionExpression(_)
                                    | JSXExpression::FunctionExpression(_)
                            );
                            self.push(
                                container.expression.span(),
                                if component && control_flow && function {
                                    ExecutionSiteKind::ControlFlowRender
                                } else if component {
                                    ExecutionSiteKind::ComponentChild
                                } else {
                                    ExecutionSiteKind::JsxChild
                                },
                            );
                        }
                        JSXChild::Spread(spread) => self.push(
                            spread.expression.span(),
                            if component {
                                ExecutionSiteKind::ComponentChild
                            } else {
                                ExecutionSiteKind::JsxChild
                            },
                        ),
                        _ => {}
                    }
                }

                if component {
                    self.mark_component_child_fragments(&element.children);
                }
                oxc_ast_visit::walk::walk_jsx_element(self, element);
            }

            fn visit_jsx_fragment(&mut self, fragment: &JSXFragment<'b>) {
                let component = self
                    .component_child_fragments
                    .contains(&SourceSpan::from(fragment.span));
                self.census_children(&fragment.children, component);
                if component {
                    self.mark_component_child_fragments(&fragment.children);
                }
                oxc_ast_visit::walk::walk_jsx_fragment(self, fragment);
            }
        }

        let mut visitor = CensusVisitor {
            sites: BTreeSet::new(),
            ignored_literal_spans: BTreeSet::new(),
            component_child_fragments: BTreeSet::new(),
            nested_void_elements: BTreeSet::new(),
            ref_factory_spans: BTreeSet::new(),
            built_ins: built_ins.iter().map(String::as_str).collect(),
            bindings: &bindings,
            inline_styles,
            mode,
        };
        visitor.visit_program(program);
        Self {
            sites: visitor.sites,
            ignored_literal_spans: visitor.ignored_literal_spans,
            ref_factory_spans: visitor.ref_factory_spans,
            mode,
        }
    }
}

#[derive(Clone, Default)]
pub(crate) struct TraceRecorder {
    census: Option<ExecutionCensus>,
    decisions: BTreeMap<SiteKey, TerminalDecision>,
    /// Spans a lowering path *synthesizes* rather than reads from the source
    /// tree. See [`Self::ignore_synthesized_child`].
    synthesized_spans: BTreeSet<SourceSpan>,
    default_effect_wrapper: bool,
    // Compatibility output for the currently pinned checker. This is filled
    // when lowering resolves a reactive value, rather than reconstructed from
    // the finished site list.
    ownership_sites: Vec<OwnershipSite>,
    owner_establishments: Vec<OwnerEstablishment>,
    component_render_sites: Vec<ComponentRenderSite>,
    deferred_callback_sites: Vec<DeferredCallbackSite>,
    next_group_id: u64,
    error: Option<String>,
}

impl TraceRecorder {
    pub(crate) fn checkpoint(&self) -> Self {
        self.clone()
    }

    pub(crate) fn restore(&mut self, checkpoint: Self) {
        *self = checkpoint;
    }

    pub(crate) fn disabled() -> Self {
        Self::default()
    }

    pub(crate) fn new(census: ExecutionCensus, default_effect_wrapper: bool) -> Self {
        Self {
            census: Some(census),
            default_effect_wrapper,
            ..Self::default()
        }
    }

    pub(crate) fn next_group_id(&mut self) -> u64 {
        let group_id = self.next_group_id;
        self.next_group_id = self.next_group_id.wrapping_add(1);
        group_id
    }

    pub(crate) fn is_recording(&self) -> bool {
        self.census.is_some()
    }

    pub(crate) fn owner_establishment(&mut self, span: Span, wrapper: &str, group_id: Option<u64>) {
        if self.census.is_some() {
            self.owner_establishments.push(OwnerEstablishment {
                span: span.into(),
                wrapper: wrapper.to_string(),
                group_id,
            });
        }
    }

    pub(crate) fn component_render_site(&mut self, span: Span) {
        if self.census.is_some() {
            self.component_render_sites
                .push(ComponentRenderSite { span: span.into() });
        }
    }

    pub(crate) fn deferred_callback_site(&mut self, span: Span, receiver_span: Span) {
        if self.census.is_some() {
            self.deferred_callback_sites.push(DeferredCallbackSite {
                span: span.into(),
                receiver_span: receiver_span.into(),
            });
        }
    }

    pub(crate) fn has_site(&self, span: Span, kind: ExecutionSiteKind) -> bool {
        self.census.as_ref().is_some_and(|census| {
            census.sites.contains(&SiteKey {
                span: span.into(),
                kind,
            })
        })
    }

    /// Resolve a lowered attribute value's censused site, whatever kind the
    /// census guessed for it.
    ///
    /// The census is syntactic and runs first, so it can only name a site
    /// from the attribute's spelling: `on*` becomes an event handler, `ref` a
    /// ref, an empty element's `children` a JSX child, anything else a native
    /// attribute. Lowering knows what the value actually became, and when it
    /// resolves the value as data — folded into the template, dropped, or
    /// written once — the truthful record depends on which kind the census
    /// chose:
    ///
    /// - a censused *value* site (native attribute, JSX child) is decided
    ///   with `decision`;
    /// - a censused *callback* site (event handler, ref) is withdrawn: the
    ///   value became template text, so no callback exists at runtime to
    ///   decide about, and a callback site cannot carry a value decision.
    ///
    /// A span the census never recorded is a no-op. Recording a hardcoded
    /// [`ExecutionSiteKind::NativeAttribute`] here instead — as every caller
    /// once did — failed the whole file for `on*`/`ref`/`children` spellings,
    /// either as an unresolved site or as a category mismatch.
    ///
    /// A template-root `children` value promoted by upstream must not come
    /// through here: child insertion owns its decision, and the attribute
    /// pipeline is told that the child came from the attribute.
    pub(crate) fn resolve_lowered_attribute(&mut self, span: Span, decision: ValueDecision) {
        for kind in [
            ExecutionSiteKind::NativeAttribute,
            ExecutionSiteKind::JsxChild,
        ] {
            if self.has_site(span, kind) {
                self.value(span, kind, decision);
                return;
            }
        }
        for kind in [ExecutionSiteKind::EventHandler, ExecutionSiteKind::Ref] {
            self.retract(span, kind);
        }
    }

    /// Withdraw a censused site that lowering proved does not exist.
    ///
    /// Reached through [`Self::resolve_lowered_attribute`] when the census
    /// named a callback site (an `on*` spelling, a `ref`) whose value
    /// lowering then resolved as plain data. Retracting is the truthful
    /// outcome — the site is not reported, rather than reported with an
    /// invented decision.
    ///
    /// Retracting a site that was never censused, or one already decided, is a
    /// no-op; this only ever removes a site nothing has spoken for.
    pub(crate) fn retract(&mut self, span: Span, kind: ExecutionSiteKind) {
        let key = SiteKey {
            span: span.into(),
            kind,
        };
        if self.decisions.contains_key(&key) {
            return;
        }
        if let Some(census) = self.census.as_mut() {
            census.sites.remove(&key);
        }
    }

    /// Withdraw every censused site inside a source range whose lowering the
    /// emitter skipped wholesale.
    ///
    /// Reached when a lowering path discards a whole child list rather than
    /// deciding it value by value — the textarea `value` fold or an inert
    /// `<noscript>`. Nothing in the range is
    /// emitted, so no site there exists to decide; retracting is the truthful
    /// outcome, and the alternative is a file-wide "unresolved execution
    /// sites" failure over expressions that never run.
    ///
    /// A site already decided is kept, matching [`Self::retract`]: this only
    /// removes sites nothing has spoken for.
    pub(crate) fn retract_within(&mut self, span: Span) {
        let Self {
            census, decisions, ..
        } = self;
        let Some(census) = census.as_mut() else {
            return;
        };
        census.sites.retain(|site| {
            decisions.contains_key(site) || site.span.start < span.start || site.span.end > span.end
        });
    }

    /// Mark every still-unresolved source operation inside a range as
    /// discarded. Unlike [`Self::retract_within`], this preserves negative
    /// proof: lowering reached the source construct and proved that none of
    /// the nested values or callbacks survive into generated code.
    pub(crate) fn discard_within(&mut self, span: Span) {
        let Some(census) = &self.census else {
            return;
        };
        let sites = census
            .sites
            .iter()
            .copied()
            .filter(|site| {
                span.start <= site.span.start
                    && site.span.end <= span.end
                    && !self.decisions.contains_key(site)
            })
            .collect::<Vec<_>>();
        for site in sites {
            let decision = if site.kind.is_value() {
                TerminalDecision::Value(ValueDecision::Elided)
            } else {
                TerminalDecision::Callback(CallbackDecision::Elided)
            };
            self.resolve(
                Span::new(site.span.start, site.span.end),
                site.kind,
                decision,
            );
        }
    }

    /// Declare that a span carries a child the lowering *synthesized*, so a
    /// decision recorded there is not an execution site.
    ///
    /// The textarea `value` fold builds its replacement child out of the
    /// attribute (`stateful_value_child`) and spans it at the attribute. That
    /// child is not a source expression — nothing the author wrote executes at
    /// that span — so the census, which only walks source, rightly claims no
    /// site there. Where the synthesized value is a string or number the
    /// census has already ignored the literal it was cloned from; where it is
    /// the `true` of a valueless `value` the expression does not exist in the
    /// source at all, and lowering's `insert` decision would otherwise fail
    /// the file as a decision for an uncensused site.
    ///
    /// Silence, not a site, is the truthful outcome: the emitted `insert` is
    /// still reported as an `owner_establishment`, exactly as for a
    /// literal-only source hole, and joins to no site.
    ///
    /// Invariant: `resolve()` consults these spans only when the census holds
    /// no site there, and every span registered here is an attribute span,
    /// which no source expression can exactly occupy. A future caller that
    /// registers a span a censused source expression *does* occupy would
    /// silence that site's decision instead of failing the file — do not.
    pub(crate) fn ignore_synthesized_child(&mut self, span: Span) {
        if self.census.is_some() && span.start < span.end {
            self.synthesized_spans.insert(span.into());
        }
    }

    pub(crate) fn value(&mut self, span: Span, kind: ExecutionSiteKind, decision: ValueDecision) {
        self.resolve(span, kind, TerminalDecision::Value(decision));
    }

    pub(crate) fn callback(
        &mut self,
        span: Span,
        kind: ExecutionSiteKind,
        decision: CallbackDecision,
    ) {
        self.resolve(span, kind, TerminalDecision::Callback(decision));
    }

    fn resolve(&mut self, span: Span, kind: ExecutionSiteKind, decision: TerminalDecision) {
        let Some(census) = &self.census else {
            return;
        };
        let key = SiteKey {
            span: span.into(),
            kind,
        };
        let not_a_site = census
            .ignored_literal_spans
            .contains(&SourceSpan::from(span))
            || self.synthesized_spans.contains(&SourceSpan::from(span));
        if !census.sites.contains(&key) {
            if not_a_site {
                return;
            }
            self.fail(format!(
                "semantic decision targets an uncensused {kind:?} site at {}..{}",
                span.start, span.end
            ));
            return;
        }
        if kind.is_value() != matches!(decision, TerminalDecision::Value(_)) {
            self.fail(format!(
                "semantic decision has the wrong category for {kind:?} at {}..{}",
                span.start, span.end
            ));
            return;
        }
        if let Some(previous) = self.decisions.insert(key, decision)
            && previous != decision
        {
            self.fail(format!(
                "semantic site {kind:?} at {}..{} received conflicting terminal decisions",
                span.start, span.end
            ));
        } else if self.default_effect_wrapper
            && matches!(
                decision,
                TerminalDecision::Value(ValueDecision::ReactiveRerun)
            )
        {
            self.ownership_sites.push(OwnershipSite {
                span: span.into(),
                decision: OwnershipDecision::Owned,
            });
        }
    }

    fn fail(&mut self, message: String) {
        if self.error.is_none() {
            self.error = Some(message);
        }
    }

    pub(crate) fn finish(
        self,
        source: &str,
        config: SemanticTraceConfig,
        output: &str,
        source_map: Option<&str>,
    ) -> Result<Option<SemanticTrace>, String> {
        let Some(census) = self.census else {
            return Ok(None);
        };
        if config.mode != census.mode {
            return Err("semantic trace mode does not match the lowering census".to_string());
        }
        if config.source_map != source_map.is_some() {
            return Err(
                "semantic trace source-map configuration does not match output".to_string(),
            );
        }
        if let Some(error) = self.error {
            return Err(error);
        }
        let unresolved = census
            .sites
            .difference(&self.decisions.keys().copied().collect())
            .map(|site| format!("{:?}@{}..{}", site.kind, site.span.start, site.span.end))
            .collect::<Vec<_>>();
        if !unresolved.is_empty() {
            return Err(format!(
                "semantic trace has unresolved execution sites: {}",
                unresolved.join(", ")
            ));
        }
        let mut ownership_sites = self.ownership_sites;
        ownership_sites.sort_unstable();
        ownership_sites.dedup();
        let mut owner_establishments = self.owner_establishments;
        owner_establishments.sort_unstable();
        owner_establishments.dedup();
        let mut component_render_sites = self.component_render_sites;
        component_render_sites.sort_unstable();
        component_render_sites.dedup();
        let mut deferred_callback_sites = self.deferred_callback_sites;
        deferred_callback_sites.sort_unstable();
        deferred_callback_sites.dedup();
        let mut generated = owner_establishments
            .iter()
            // `component_render_sites` is the authoritative one-per-call
            // source. The legacy wrapper observation remains serialized for
            // trace-v2 consumers but must not duplicate the generated call.
            .filter(|site| site.wrapper != "createComponent")
            .map(generated_from_owner)
            .chain(
                component_render_sites
                    .iter()
                    .map(|site| GeneratedOperation {
                        id: String::new(),
                        source_id: generated_source_id(site.span, "component-invocation"),
                        source_span: site.span,
                        kind: GeneratedOperationKind::ComponentInvocation,
                        trigger: ExecutionTrigger::Render,
                        schedule: ExecutionSchedule::Inline,
                        tracking: TrackingRelation::Untracked,
                        cardinality: ExecutionCardinality::ExactlyOnce,
                        owner: OwnerRelation::Unknown,
                        receiver_span: None,
                        group_id: None,
                        wrapper: None,
                    }),
            )
            .chain(
                deferred_callback_sites
                    .iter()
                    .map(|site| GeneratedOperation {
                        id: String::new(),
                        source_id: generated_source_id(site.span, "deferred-callback"),
                        source_span: site.span,
                        kind: GeneratedOperationKind::DeferredCallback,
                        trigger: ExecutionTrigger::Caller,
                        schedule: ExecutionSchedule::Deferred,
                        tracking: TrackingRelation::Inherited,
                        cardinality: ExecutionCardinality::Unknown,
                        owner: OwnerRelation::AmbientAtGeneratedInvocation,
                        receiver_span: Some(site.receiver_span),
                        group_id: None,
                        wrapper: None,
                    }),
            )
            .collect::<Vec<_>>();
        generated.sort_unstable_by(|left, right| {
            (
                left.source_span,
                left.kind,
                &left.wrapper,
                left.receiver_span,
                left.group_id,
            )
                .cmp(&(
                    right.source_span,
                    right.kind,
                    &right.wrapper,
                    right.receiver_span,
                    right.group_id,
                ))
        });
        generated.dedup_by(|left, right| {
            left.source_span == right.source_span
                && left.kind == right.kind
                && left.wrapper == right.wrapper
                && left.receiver_span == right.receiver_span
                && left.group_id == right.group_id
        });
        for (index, operation) in generated.iter_mut().enumerate() {
            operation.id = format!("g{index}");
        }
        let mode = census.mode;
        let ref_factory_spans = census.ref_factory_spans;
        let sites = census
            .sites
            .into_iter()
            .map(|site| {
                let id = source_operation_id(site);
                let generated_operations = generated
                    .iter()
                    .filter(|operation| {
                        site.span.start <= operation.source_span.start
                            && operation.source_span.end <= site.span.end
                    })
                    .map(|operation| operation.id.clone())
                    .collect();
                let decision = self.decisions[&site];
                ExecutionSite {
                    id,
                    span: site.span,
                    kind: site.kind,
                    decision,
                    semantics: execution_semantics(
                        mode,
                        site,
                        decision,
                        ref_factory_spans.contains(&site.span),
                        self.default_effect_wrapper,
                        generated_operations,
                    ),
                }
            })
            .collect::<Vec<_>>();
        Ok(Some(SemanticTrace {
            version: SEMANTIC_TRACE_VERSION,
            identity: SemanticTraceIdentity {
                compiler: SemanticCompilerIdentity {
                    package_version: crate::COMPILER_VERSION.to_string(),
                    upstream_revision: SEMANTIC_TRACE_UPSTREAM_REVISION.to_string(),
                    implementation_revision: SEMANTIC_TRACE_IMPLEMENTATION_REVISION.to_string(),
                },
                source_sha256: sha256_hex(source.as_bytes()),
                output_sha256: sha256_hex(output.as_bytes()),
                source_map_sha256: source_map.map(|map| sha256_hex(map.as_bytes())),
                config,
            },
            sites,
            ownership_sites,
            owner_establishments,
            component_render_sites,
            deferred_callback_sites,
            generated_operations: generated,
        }))
    }
}

fn source_operation_id(site: SiteKey) -> String {
    format!(
        "s:{}:{}:{}",
        site.span.start,
        site.span.end,
        site.kind.name()
    )
}

fn generated_source_id(span: SourceSpan, kind: &str) -> String {
    format!("s:{}:{}:{kind}", span.start, span.end)
}

fn generated_from_owner(site: &OwnerEstablishment) -> GeneratedOperation {
    let (kind, trigger, schedule, tracking, cardinality, owner) = match site.wrapper.as_str() {
        "effect" => (
            GeneratedOperationKind::Effect,
            ExecutionTrigger::Dependency,
            ExecutionSchedule::Render,
            TrackingRelation::Tracked,
            ExecutionCardinality::OneOrMore,
            OwnerRelation::CreatedGeneratedOwner,
        ),
        "insert" => (
            GeneratedOperationKind::Insert,
            ExecutionTrigger::Render,
            ExecutionSchedule::Render,
            TrackingRelation::Tracked,
            ExecutionCardinality::OneOrMore,
            OwnerRelation::CreatedGeneratedOwner,
        ),
        "memo" => (
            GeneratedOperationKind::Memo,
            ExecutionTrigger::Dependency,
            ExecutionSchedule::Render,
            TrackingRelation::Tracked,
            ExecutionCardinality::OneOrMore,
            OwnerRelation::CreatedGeneratedOwner,
        ),
        "scope" => (
            GeneratedOperationKind::Scope,
            ExecutionTrigger::Caller,
            ExecutionSchedule::Render,
            TrackingRelation::Inherited,
            ExecutionCardinality::Unknown,
            OwnerRelation::CapturedGeneratedOwner,
        ),
        "createComponent" => (
            GeneratedOperationKind::ComponentInvocation,
            ExecutionTrigger::Render,
            ExecutionSchedule::Inline,
            TrackingRelation::Untracked,
            ExecutionCardinality::ExactlyOnce,
            OwnerRelation::Unknown,
        ),
        "delegated" => (
            GeneratedOperationKind::DelegatedEvent,
            ExecutionTrigger::Event,
            ExecutionSchedule::Deferred,
            TrackingRelation::Untracked,
            ExecutionCardinality::ZeroOrMore,
            OwnerRelation::None,
        ),
        "ref-apply" => (
            GeneratedOperationKind::RefApplication,
            ExecutionTrigger::RefApplication,
            ExecutionSchedule::Render,
            TrackingRelation::Untracked,
            ExecutionCardinality::ZeroOrMore,
            OwnerRelation::None,
        ),
        "ssr-claim" => (
            GeneratedOperationKind::SsrClaim,
            ExecutionTrigger::Render,
            ExecutionSchedule::Render,
            TrackingRelation::Inherited,
            ExecutionCardinality::ZeroOrOne,
            OwnerRelation::AmbientAtGeneratedInvocation,
        ),
        _ => (
            GeneratedOperationKind::RuntimeWrapper,
            ExecutionTrigger::Unknown,
            ExecutionSchedule::Unknown,
            TrackingRelation::Unknown,
            ExecutionCardinality::Unknown,
            OwnerRelation::Unknown,
        ),
    };
    GeneratedOperation {
        id: String::new(),
        source_id: generated_source_id(site.span, kind.name()),
        source_span: site.span,
        kind,
        trigger,
        schedule,
        tracking,
        cardinality,
        owner,
        receiver_span: None,
        group_id: site.group_id,
        wrapper: Some(site.wrapper.clone()),
    }
}

fn execution_semantics(
    mode: SemanticTraceMode,
    site: SiteKey,
    decision: TerminalDecision,
    ref_factory: bool,
    default_effect_wrapper: bool,
    generated_operations: Vec<String>,
) -> ExecutionSemantics {
    let (disposition, trigger, schedule, tracking, cardinality, owner) = match decision {
        TerminalDecision::Value(ValueDecision::Elided) => (
            ExecutionDisposition::Discarded,
            ExecutionTrigger::None,
            ExecutionSchedule::None,
            TrackingRelation::None,
            ExecutionCardinality::Never,
            OwnerRelation::None,
        ),
        TerminalDecision::Value(ValueDecision::SsrEvaluation) => (
            ExecutionDisposition::SsrEvaluation,
            ExecutionTrigger::Render,
            ExecutionSchedule::Render,
            TrackingRelation::Inherited,
            ExecutionCardinality::ExactlyOnce,
            OwnerRelation::AmbientAtTransformSite,
        ),
        TerminalDecision::Value(ValueDecision::SsrRenderCallback) => (
            ExecutionDisposition::SsrRenderCallback,
            ExecutionTrigger::Caller,
            ExecutionSchedule::Render,
            TrackingRelation::Inherited,
            ExecutionCardinality::ExactlyOnce,
            OwnerRelation::AmbientAtGeneratedInvocation,
        ),
        TerminalDecision::Value(ValueDecision::ReactiveRerun) => (
            ExecutionDisposition::ReactiveRerun,
            ExecutionTrigger::Dependency,
            ExecutionSchedule::Render,
            TrackingRelation::Tracked,
            ExecutionCardinality::OneOrMore,
            if default_effect_wrapper {
                OwnerRelation::CreatedGeneratedOwner
            } else {
                OwnerRelation::Unknown
            },
        ),
        TerminalDecision::Value(ValueDecision::CallerContext) => (
            if site.kind == ExecutionSiteKind::ComponentProperty {
                ExecutionDisposition::ComponentPropertyGetter
            } else {
                ExecutionDisposition::Deferred
            },
            ExecutionTrigger::Caller,
            ExecutionSchedule::Deferred,
            TrackingRelation::Inherited,
            ExecutionCardinality::Unknown,
            OwnerRelation::AmbientAtGeneratedInvocation,
        ),
        TerminalDecision::Value(ValueDecision::EagerOnce) => (
            if mode == SemanticTraceMode::Ssr {
                ExecutionDisposition::SsrEvaluation
            } else {
                ExecutionDisposition::EagerOnce
            },
            ExecutionTrigger::Render,
            ExecutionSchedule::Inline,
            if mode == SemanticTraceMode::Ssr {
                TrackingRelation::Inherited
            } else {
                TrackingRelation::Untracked
            },
            ExecutionCardinality::ExactlyOnce,
            OwnerRelation::AmbientAtTransformSite,
        ),
        TerminalDecision::Callback(CallbackDecision::Elided) => (
            ExecutionDisposition::Discarded,
            ExecutionTrigger::None,
            ExecutionSchedule::None,
            TrackingRelation::None,
            ExecutionCardinality::Never,
            OwnerRelation::None,
        ),
        TerminalDecision::Callback(
            CallbackDecision::LaterEvent | CallbackDecision::ConditionalEventClaim,
        ) => (
            ExecutionDisposition::EventTriggered,
            ExecutionTrigger::Event,
            ExecutionSchedule::Deferred,
            TrackingRelation::Untracked,
            ExecutionCardinality::ZeroOrMore,
            OwnerRelation::None,
        ),
        TerminalDecision::Callback(CallbackDecision::LaterRender) => (
            ExecutionDisposition::ControlFlowRender,
            ExecutionTrigger::Caller,
            ExecutionSchedule::Render,
            TrackingRelation::Untracked,
            ExecutionCardinality::ZeroOrMore,
            OwnerRelation::AmbientAtGeneratedInvocation,
        ),
        TerminalDecision::Callback(CallbackDecision::RefFactoryOnly) => (
            ExecutionDisposition::RefFactory,
            ExecutionTrigger::Render,
            ExecutionSchedule::Inline,
            TrackingRelation::Untracked,
            ExecutionCardinality::ExactlyOnce,
            OwnerRelation::AmbientAtTransformSite,
        ),
        TerminalDecision::Callback(CallbackDecision::ConditionalRefFactoryClaim) => (
            ExecutionDisposition::RefFactory,
            ExecutionTrigger::Render,
            ExecutionSchedule::Render,
            TrackingRelation::Inherited,
            ExecutionCardinality::ZeroOrOne,
            OwnerRelation::AmbientAtGeneratedInvocation,
        ),
        TerminalDecision::Callback(
            CallbackDecision::RefApply | CallbackDecision::ConditionalRefClaim,
        ) => (
            if ref_factory {
                ExecutionDisposition::RefFactory
            } else {
                ExecutionDisposition::RefApplication
            },
            if ref_factory {
                ExecutionTrigger::Render
            } else {
                ExecutionTrigger::RefApplication
            },
            if ref_factory {
                ExecutionSchedule::Inline
            } else {
                ExecutionSchedule::Render
            },
            TrackingRelation::Untracked,
            if ref_factory {
                ExecutionCardinality::ExactlyOnce
            } else {
                ExecutionCardinality::ZeroOrMore
            },
            if ref_factory {
                OwnerRelation::AmbientAtTransformSite
            } else {
                OwnerRelation::None
            },
        ),
    };
    ExecutionSemantics {
        disposition,
        trigger,
        schedule,
        tracking,
        cardinality,
        owner,
        generated_operations,
    }
}

pub(crate) fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

impl SemanticTraceConfig {
    pub(crate) fn from_options(options: &crate::compiler::CompileOptions) -> Option<Self> {
        use crate::compiler::Generate;

        let mode = match options.generate {
            Generate::Dom => SemanticTraceMode::Dom,
            Generate::Ssr => SemanticTraceMode::Ssr,
            Generate::Universal | Generate::Dynamic => return None,
        };
        Some(Self {
            filename: options.filename.clone(),
            module_name: options.module_name.clone(),
            mode,
            hydratable: options.hydratable,
            server_components: options.server_components,
            dev: options.dev,
            source_map: options.source_map,
            context_to_custom_elements: options.context_to_custom_elements,
            delegate_events: options.delegate_events,
            delegated_events: options.delegated_events.clone(),
            omit_quotes: options.omit_quotes,
            omit_attribute_spacing: options.omit_attribute_spacing,
            inline_styles: options.inline_styles,
            effect_wrapper: wrapper_identity(&options.effect_wrapper),
            wrap_conditionals: options.wrap_conditionals,
            memo_wrapper: wrapper_identity(&options.memo_wrapper),
            patch_driver: wrapper_identity(&options.patch_driver),
            static_marker: options.static_marker.clone(),
            require_import_source: options.require_import_source.clone(),
            validate: options.validate,
            omit_nested_closing_tags: options.omit_nested_closing_tags,
            omit_last_closing_tag: options.omit_last_closing_tag,
            built_ins: options.built_ins.clone(),
            renderers: options
                .renderers
                .iter()
                .map(|renderer| SemanticRendererConfig {
                    name: renderer.name.clone(),
                    module_name: renderer.module_name.clone(),
                    elements: renderer.elements.clone(),
                })
                .collect(),
        })
    }
}

fn wrapper_identity(wrapper: &crate::compiler::Wrapper) -> String {
    match wrapper {
        crate::compiler::Wrapper::Default => "default".to_string(),
        crate::compiler::Wrapper::Disabled => "disabled".to_string(),
        crate::compiler::Wrapper::Name(name) => format!("name:{name}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn census(kind: ExecutionSiteKind) -> ExecutionCensus {
        ExecutionCensus {
            sites: [SiteKey {
                span: SourceSpan { start: 1, end: 2 },
                kind,
            }]
            .into_iter()
            .collect(),
            ignored_literal_spans: BTreeSet::new(),
            ref_factory_spans: BTreeSet::new(),
            mode: SemanticTraceMode::Dom,
        }
    }

    fn finish(recorder: TraceRecorder) -> Result<Option<SemanticTrace>, String> {
        recorder.finish(
            "source",
            SemanticTraceConfig::from_options(&crate::CompileOptions::default())
                .expect("DOM is traceable"),
            "output",
            None,
        )
    }

    #[test]
    fn finish_rejects_an_unresolved_site() {
        let recorder = TraceRecorder::new(census(ExecutionSiteKind::JsxChild), true);
        assert!(finish(recorder).unwrap_err().contains("unresolved"));
    }

    #[test]
    fn finish_rejects_conflicting_decisions() {
        let mut recorder = TraceRecorder::new(census(ExecutionSiteKind::JsxChild), true);
        recorder.value(
            Span::new(1, 2),
            ExecutionSiteKind::JsxChild,
            ValueDecision::EagerOnce,
        );
        recorder.value(
            Span::new(1, 2),
            ExecutionSiteKind::JsxChild,
            ValueDecision::ReactiveRerun,
        );
        assert!(finish(recorder).unwrap_err().contains("conflicting"));
    }

    #[test]
    fn finish_rejects_uncensused_decisions() {
        let mut recorder = TraceRecorder::new(census(ExecutionSiteKind::JsxChild), true);
        recorder.value(
            Span::new(3, 4),
            ExecutionSiteKind::JsxChild,
            ValueDecision::EagerOnce,
        );
        assert!(finish(recorder).unwrap_err().contains("uncensused"));
    }

    #[test]
    fn owner_establishments_keep_a_shared_group_id_and_sort_deterministically() {
        let mut recorder = TraceRecorder::new(census(ExecutionSiteKind::JsxChild), true);
        recorder.value(
            Span::new(1, 2),
            ExecutionSiteKind::JsxChild,
            ValueDecision::ReactiveRerun,
        );
        assert_eq!(
            finish(recorder).unwrap().unwrap().ownership_sites,
            vec![OwnershipSite {
                span: SourceSpan { start: 1, end: 2 },
                decision: OwnershipDecision::Owned,
            }]
        );

        let mut recorder = TraceRecorder::new(census(ExecutionSiteKind::JsxChild), true);
        let group_id = recorder.next_group_id();
        recorder.value(
            Span::new(1, 2),
            ExecutionSiteKind::JsxChild,
            ValueDecision::EagerOnce,
        );
        recorder.owner_establishment(Span::new(3, 4), "effect", Some(group_id));
        recorder.owner_establishment(Span::new(1, 2), "effect", Some(group_id));
        let trace = finish(recorder).unwrap().unwrap();
        assert_eq!(
            trace.owner_establishments,
            vec![
                OwnerEstablishment {
                    span: SourceSpan { start: 1, end: 2 },
                    wrapper: "effect".into(),
                    group_id: Some(0),
                },
                OwnerEstablishment {
                    span: SourceSpan { start: 3, end: 4 },
                    wrapper: "effect".into(),
                    group_id: Some(0),
                },
            ]
        );
    }

    #[test]
    fn custom_effect_reruns_make_no_owner_claim() {
        let mut recorder = TraceRecorder::new(census(ExecutionSiteKind::JsxChild), false);
        recorder.value(
            Span::new(1, 2),
            ExecutionSiteKind::JsxChild,
            ValueDecision::ReactiveRerun,
        );
        assert!(
            finish(recorder)
                .unwrap()
                .unwrap()
                .ownership_sites
                .is_empty()
        );
    }

    #[test]
    fn disabled_recorders_do_not_allocate_additive_facts() {
        let mut recorder = TraceRecorder::disabled();
        recorder.owner_establishment(Span::new(1, 2), "customEffect", None);
        recorder.component_render_site(Span::new(1, 2));
        recorder.deferred_callback_site(Span::new(1, 2), Span::new(3, 4));
        assert_eq!(finish(recorder).unwrap(), None);
    }
}
