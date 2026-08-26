use crate::error::{Error, Result};
use oxc_ast::ast::{JSXChild, JSXElement, JSXExpression};
use oxc_span::GetSpan;

use crate::dom::attrs::CloseTagContext;
use crate::dom::element::{AstDomTransform, children_attribute_child};
use crate::shared::utils::{
    element_name, escape_html_text, escape_html_text_expression, is_component_name,
    static_jsx_expression_value, trim_jsx_text,
};

pub(crate) fn lower_static_native_template<'a>(
    ctx: &mut AstDomTransform<'a, '_>,
    element: &JSXElement<'a>,
    close_context: CloseTagContext,
) -> Result<Option<crate::dom::template::TemplateHtml>> {
    // Static lowering is speculative. Keep its semantic observations only
    // when the entire subtree commits to the static path; dynamic fallback
    // will record the authoritative decisions for the same source spans.
    let checkpoint = ctx.semantic_trace.checkpoint();
    let result = lower_static_native_template_inner(ctx, element, close_context);
    if !matches!(result, Ok(Some(_))) {
        ctx.semantic_trace.restore(checkpoint);
    }
    result
}

fn lower_static_native_template_inner<'a>(
    ctx: &mut AstDomTransform<'a, '_>,
    element: &JSXElement<'a>,
    close_context: CloseTagContext,
) -> Result<Option<crate::dom::template::TemplateHtml>> {
    if is_component_name(&element.opening_element.name) {
        return Ok(None);
    }

    let tag_name = element_name(&element.opening_element.name)?;

    // Claim targets (a[href] / form[action]) can't inline into a static
    // subtree — the emitted claimElement call needs an element reference, so
    // they take the dynamic-child path. Descendants are covered by recursion
    // (a child returning None propagates None up).
    if crate::dom::element::is_claim_target(&tag_name, &element.opening_element.attributes) {
        return Ok(None);
    }
    // Owner context is a runtime assignment. Custom elements, customized
    // built-ins, and slots therefore cannot disappear into a static nested
    // template even when their attributes and children are otherwise static.
    if ctx.should_capture_custom_element_context(element, &tag_name) {
        return Ok(None);
    }

    let mut template = crate::dom::template::TemplateHtml::open_tag(&tag_name);

    // Attributes only land in the emitted markup, not the validation variant.
    let Some(children_replacement) = ctx.try_append_planned_static_attributes(
        &element.opening_element.attributes,
        &tag_name,
        &mut template.html,
    )?
    else {
        return Ok(None);
    };

    template.push_both(">");

    if tag_name == "noscript" {
        ctx.retract_children_sites(&element.children);
        if ctx.should_close_tag(&tag_name, close_context.clone()) {
            template.html.push_str(&format!("</{tag_name}>"));
        }
        if !crate::shared::utils::is_void_element(&tag_name) {
            template.closed.push_str(&format!("</{tag_name}>"));
        }
        return Ok(Some(template));
    }

    let child_to_be_closed = ctx.child_close_context(&tag_name, close_context.clone());
    // The textarea `value` fold replaces the element's children with a
    // single synthesized child.
    let attribute_child = if children_replacement.is_none()
        && element.children.is_empty()
        && !crate::shared::utils::is_void_element(&tag_name)
    {
        children_attribute_child(ctx, element)
    } else {
        None
    };
    let children: &[JSXChild<'a>] = match (&children_replacement, &attribute_child) {
        (Some(child), _) => {
            ctx.discard_folded_children(&element.children, child);
            std::slice::from_ref(child)
        }
        (_, Some(child)) => std::slice::from_ref(child),
        (None, None) => &element.children,
    };
    let last_element = ctx.find_last_element(children);
    for (index, child) in children.iter().enumerate() {
        match child {
            JSXChild::Text(text) => {
                let text = trim_jsx_text(&text.value);
                if !text.is_empty() {
                    template.push_both(&escape_html_text(&text));
                }
            }
            JSXChild::ExpressionContainer(container) => {
                if matches!(container.expression, JSXExpression::EmptyExpression(_)) {
                    continue;
                }
                let value = ctx
                    .static_jsx_expression_value(&container.expression)
                    .or_else(|| static_jsx_expression_value(&container.expression));
                let Some(value) = value else {
                    return Ok(None);
                };
                ctx.semantic_trace.value(
                    container.expression.span(),
                    crate::semantic_trace::ExecutionSiteKind::JsxChild,
                    crate::semantic_trace::ValueDecision::Elided,
                );
                template.push_both(&escape_html_text_expression(&value));
            }
            JSXChild::Element(child) => {
                // Cross-renderer nesting errors even in fully static subtrees
                // (Babel routes the child through the other renderer's
                // transform first, then throws in `transformChildren`).
                if ctx.is_foreign_element(child) {
                    let child_tag = element_name(&child.opening_element.name)?;
                    return Err(Error::from_reason(format!(
                        "<{child_tag}> is not supported in <{tag_name}>.\n      Wrap the usage with a component that would render this element, eg. Canvas"
                    )));
                }
                let Some(child_template) = lower_static_native_template(
                    ctx,
                    child,
                    CloseTagContext {
                        last_element: Some(index) == last_element,
                        to_be_closed: child_to_be_closed.clone(),
                    },
                )?
                else {
                    return Ok(None);
                };
                template.append(child_template);
            }
            _ => return Ok(None),
        }
    }

    if ctx.should_close_tag(&tag_name, close_context) {
        template.html.push_str(&format!("</{tag_name}>"));
    }
    if !crate::shared::utils::is_void_element(&tag_name) {
        template.closed.push_str(&format!("</{tag_name}>"));
    }

    Ok(Some(template))
}
