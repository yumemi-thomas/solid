//! `"use server"` directive transform — the second, independent pass of the
//! compiler (alongside the JSX pass). Ported from the Babel implementation
//! living in vite-plugin-solid `src/server-functions/` (hoisted from
//! solid-start); the parity suite in `__tests__/` checks the two produce the
//! same output for shared fixtures.
//!
//! The runtime ABI is frozen: `registerServerReference(id, fn)` on the
//! server, `createServerReference(id)` proxies on the client, and the
//! `<xxhash32(relative path)>-<count>` ID format shared by both builds.

mod dce;
mod transform;
mod validate;
pub(crate) mod xxhash;

use napi::bindgen_prelude::*;
use napi_derive::napi;
use oxc_allocator::Allocator;
use oxc_codegen::{Codegen, CodegenOptions};
use oxc_parser::{ParseOptions, Parser};

use crate::config::source_type_for_filename;
use transform::{DirectivesTransform, Env, ImportDef, ImportKind, Mode};

const DEFAULT_RUNTIME: &str = "@solidjs/web/server-functions";

/// A runtime import override, mirroring the Babel plugin's
/// `ImportDefinition` (`kind: "named" | "default"`).
#[napi(object)]
#[derive(Default)]
pub struct DirectiveImportOption {
    pub kind: Option<String>,
    pub name: Option<String>,
    pub source: String,
}

#[napi(object)]
#[derive(Default)]
pub struct TransformDirectivesOptions {
    pub filename: Option<String>,
    /// Project root; function IDs hash the root-relative path so client and
    /// server builds of the same checkout agree on every ID without baking
    /// machine-specific absolute paths into the output.
    pub root: Option<String>,
    /// `"server"` keeps the module and registers extracted functions;
    /// `"client"` replaces them with reference proxies.
    pub mode: Option<String>,
    /// `"development"` appends the function name to generated IDs.
    pub env: Option<String>,
    /// The directive text. Default `"use server"`.
    pub directive: Option<String>,
    pub source_map: Option<bool>,
    /// Runtime import for `registerServerReference` (server output).
    pub register: Option<DirectiveImportOption>,
    /// Runtime import for `createServerReference` (both outputs).
    pub create: Option<DirectiveImportOption>,
    /// Emit a hash-bound semantic trace of the server-function boundary
    /// transformation. This side channel never changes generated output.
    pub semantic_trace: Option<bool>,
}

/// One extracted server function, for the bundler plugin's manifest.
#[napi(object)]
pub struct ServerFunctionMeta {
    /// The wire ID (`<hash>-<count>[-<name>]`).
    pub id: String,
    /// The descriptive source name (`anonymous` when none applies).
    pub name: String,
    /// Export names bound to this function (module-level directives only;
    /// empty for function-level extractions).
    pub exports: Vec<String>,
}

#[napi(object)]
pub struct TransformDirectivesResult {
    pub code: String,
    pub map: Option<String>,
    /// Whether the pass transformed anything — mirrors the Babel
    /// implementation's `valid` flag; callers should keep the original
    /// module when false.
    pub valid: bool,
    pub functions: Vec<ServerFunctionMeta>,
    /// JSON-encoded [`crate::ServerFunctionSemanticTrace`] when requested.
    pub semantic_trace: Option<String>,
}

pub fn transform_directives(
    code: String,
    options: Option<TransformDirectivesOptions>,
) -> Result<TransformDirectivesResult> {
    let options = options.unwrap_or_default();
    let semantic_trace_requested = options.semantic_trace.unwrap_or(false);
    let source_sha256 = crate::semantic_trace::sha256_hex(code.as_bytes());

    let mode = match options.mode.as_deref() {
        Some("server") => Mode::Server,
        Some("client") => Mode::Client,
        _ => {
            return Err(Error::from_reason(
                "transformDirectives requires a `mode` option of \"server\" or \"client\"",
            ));
        }
    };
    let env = match options.env.as_deref() {
        None | Some("production") => Env::Production,
        Some("development") => Env::Development,
        _ => {
            return Err(Error::from_reason(
                "transformDirectives `env` option must be \"production\" or \"development\"",
            ));
        }
    };
    let Some(filename) = options.filename.as_deref() else {
        return Err(Error::from_reason(
            "transformDirectives requires a `filename` option (function IDs hash the file path)",
        ));
    };
    let directive = options
        .directive
        .clone()
        .unwrap_or_else(|| "use server".to_string());

    let source_type = source_type_for_filename(Some(filename))?;
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, &code, source_type)
        .with_options(ParseOptions {
            preserve_parens: false,
            ..ParseOptions::default()
        })
        .parse();
    if let Some(error) = crate::shared::parser::first_parser_error(parsed.diagnostics) {
        return Err(Error::from_reason(error));
    }

    let hash = xxhash::xxhash32_hex(&relative_id(options.root.as_deref(), filename));

    let mut program = parsed.program;

    // Closure-capture validation for function-level directives. Module-level
    // directives are unaffected: the whole module runs on the server, so its
    // closures survive intact.
    let is_module_level = program
        .directives
        .iter()
        .any(|entry| entry.expression.value == directive);
    if !is_module_level {
        validate::validate_captures(&program, &code, filename, &directive)
            .map_err(Error::from_reason)?;
    }

    let register = import_def(options.register.as_ref(), "registerServerReference");
    let create = import_def(options.create.as_ref(), "createServerReference");
    let semantic_config = crate::semantic_trace::ServerFunctionTraceConfig {
        filename: filename.to_string(),
        root: options.root.clone(),
        mode: match mode {
            Mode::Client => crate::semantic_trace::ServerFunctionTransformMode::Client,
            Mode::Server => crate::semantic_trace::ServerFunctionTransformMode::Server,
        },
        env: match env {
            Env::Development => crate::semantic_trace::ServerFunctionTransformEnv::Development,
            Env::Production => crate::semantic_trace::ServerFunctionTransformEnv::Production,
        },
        directive: directive.clone(),
        source_map: options.source_map.unwrap_or(false),
        register: semantic_import_config(&register),
        create: semantic_import_config(&create),
    };
    let mut pass =
        DirectivesTransform::new(&allocator, mode, env, directive, hash, register, create);
    pass.run(&mut program);

    let valid = pass.valid;
    let functions = pass
        .functions
        .iter()
        .map(|function| ServerFunctionMeta {
            id: function.id.clone(),
            name: function.name.clone(),
            exports: function.exports.clone(),
        })
        .collect();
    let semantic_functions = pass
        .functions
        .iter()
        .map(|function| crate::semantic_trace::ServerFunctionOperation {
            id: function.id.clone(),
            name: function.name.clone(),
            exports: function.exports.clone(),
            source_span: function.source_span,
            directive_span: function.directive_span,
            scope: function.scope,
            boundary: "server-function-reference".to_string(),
            creates_reference: true,
            registers_server_implementation: mode == Mode::Server,
        })
        .collect::<Vec<_>>();
    let needs_dce = pass.needs_dce();
    let orphans = std::mem::take(&mut pass.orphans);
    drop(pass);

    let source_map = options.source_map.unwrap_or(false);
    let codegen = |program: &oxc_ast::ast::Program<'_>| {
        let build = Codegen::new()
            .with_options(CodegenOptions {
                source_map_path: source_map.then(|| std::path::PathBuf::from(filename)),
                ..CodegenOptions::default()
            })
            .build(program);
        (build.code, build.map.map(|map| map.to_json_string()))
    };

    let (build_code, build_map) = codegen(&program);
    let (code, map) = if needs_dce {
        // Babel's `removeUnusedVariables` fixpoint. This port re-parses
        // printed output between passes, so when it runs the source map is
        // regenerated relative to the pre-DCE output (a known limitation).
        let cleaned =
            dce::remove_unused_variables(build_code, source_type, orphans, env == Env::Development);
        if source_map {
            let allocator = Allocator::default();
            let reparsed = Parser::new(&allocator, &cleaned, source_type)
                .with_options(ParseOptions {
                    preserve_parens: false,
                    ..ParseOptions::default()
                })
                .parse();
            codegen(&reparsed.program)
        } else {
            (cleaned, None)
        }
    } else {
        (build_code, build_map)
    };

    let semantic_trace = semantic_trace_requested
        .then(|| {
            serde_json::to_string(&crate::semantic_trace::ServerFunctionSemanticTrace {
                version: crate::semantic_trace::SEMANTIC_TRACE_VERSION,
                identity: crate::semantic_trace::ServerFunctionTraceIdentity {
                    compiler: crate::semantic_trace::SemanticCompilerIdentity {
                        package_version: crate::COMPILER_VERSION.to_string(),
                        upstream_revision: crate::semantic_trace::SEMANTIC_TRACE_UPSTREAM_REVISION
                            .to_string(),
                        implementation_revision:
                            crate::semantic_trace::SEMANTIC_TRACE_IMPLEMENTATION_REVISION
                                .to_string(),
                    },
                    source_sha256,
                    output_sha256: crate::semantic_trace::sha256_hex(code.as_bytes()),
                    source_map_sha256: map
                        .as_deref()
                        .map(|map| crate::semantic_trace::sha256_hex(map.as_bytes())),
                    config: semantic_config,
                },
                functions: semantic_functions,
            })
            .map_err(|error| Error::from_reason(format!("serialize semantic trace: {error}")))
        })
        .transpose()?;

    Ok(TransformDirectivesResult {
        code,
        map,
        valid,
        functions,
        semantic_trace,
    })
}

fn semantic_import_config(import: &ImportDef) -> crate::semantic_trace::ServerFunctionImportConfig {
    crate::semantic_trace::ServerFunctionImportConfig {
        kind: match import.kind {
            ImportKind::Named => "named",
            ImportKind::Default => "default",
        }
        .to_string(),
        name: import.name.clone(),
        source: import.source.clone(),
    }
}

#[cfg(test)]
#[allow(clippy::items_after_test_module)]
mod semantic_tests {
    use super::*;

    fn options(mode: &str, semantic_trace: bool) -> TransformDirectivesOptions {
        TransformDirectivesOptions {
            filename: Some("/project/src/actions.ts".to_string()),
            root: Some("/project".to_string()),
            mode: Some(mode.to_string()),
            env: Some("production".to_string()),
            directive: Some("use server".to_string()),
            source_map: Some(true),
            register: None,
            create: None,
            semantic_trace: Some(semantic_trace),
        }
    }

    #[test]
    fn server_function_trace_is_output_neutral_hash_bound_and_mode_exact() {
        let source = "export const save = async () => { \"use server\"; return await write(); };";
        let plain = transform_directives(source.to_string(), Some(options("server", false)))
            .expect("plain directive transform");
        let traced = transform_directives(source.to_string(), Some(options("server", true)))
            .expect("traced directive transform");
        assert_eq!(plain.code, traced.code);
        assert_eq!(plain.map, traced.map);
        assert!(plain.semantic_trace.is_none());

        let trace: crate::semantic_trace::ServerFunctionSemanticTrace = serde_json::from_str(
            traced
                .semantic_trace
                .as_deref()
                .expect("semantic trace JSON"),
        )
        .expect("typed server-function trace");
        assert_eq!(trace.version, crate::semantic_trace::SEMANTIC_TRACE_VERSION);
        assert_eq!(
            trace.identity.config.mode,
            crate::semantic_trace::ServerFunctionTransformMode::Server
        );
        assert_eq!(trace.identity.config.filename, "/project/src/actions.ts");
        assert_eq!(trace.identity.source_sha256.len(), 64);
        assert_eq!(trace.identity.output_sha256.len(), 64);
        assert_ne!(trace.identity.source_sha256, trace.identity.output_sha256);
        assert_eq!(trace.functions.len(), 1);
        let function = &trace.functions[0];
        assert_eq!(function.name, "save");
        assert_eq!(
            function.scope,
            crate::semantic_trace::ServerFunctionScope::Function
        );
        assert_eq!(function.boundary, "server-function-reference");
        assert!(function.creates_reference);
        assert!(function.registers_server_implementation);
        assert_eq!(
            &source[function.directive_span.start as usize..function.directive_span.end as usize],
            "\"use server\";"
        );
        assert!(
            source[function.source_span.start as usize..function.source_span.end as usize]
                .starts_with("async ()")
        );

        let client = transform_directives(source.to_string(), Some(options("client", true)))
            .expect("client directive transform");
        let client_trace: crate::semantic_trace::ServerFunctionSemanticTrace =
            serde_json::from_str(client.semantic_trace.as_deref().expect("client trace JSON"))
                .expect("typed client trace");
        assert_eq!(
            client_trace.identity.config.mode,
            crate::semantic_trace::ServerFunctionTransformMode::Client
        );
        assert_eq!(client_trace.functions[0].id, function.id);
        assert!(client_trace.functions[0].creates_reference);
        assert!(!client_trace.functions[0].registers_server_implementation);
    }

    #[test]
    fn module_directive_trace_preserves_export_and_initializer_identity() {
        let source = "\"use server\"; const impl = async () => read(); export { impl as load, impl as reload };";
        let server = transform_directives(source.to_string(), Some(options("server", true)))
            .expect("server module transform");
        let server_trace: crate::semantic_trace::ServerFunctionSemanticTrace =
            serde_json::from_str(
                server
                    .semantic_trace
                    .as_deref()
                    .expect("server module trace"),
            )
            .expect("typed server module trace");
        let function = &server_trace.functions[0];
        assert_eq!(
            function.scope,
            crate::semantic_trace::ServerFunctionScope::Module
        );
        assert_eq!(function.exports, ["load", "reload"]);
        assert_eq!(
            &source[function.directive_span.start as usize..function.directive_span.end as usize],
            "\"use server\";"
        );
        assert_eq!(
            &source[function.source_span.start as usize..function.source_span.end as usize],
            "async () => read()"
        );

        let client = transform_directives(source.to_string(), Some(options("client", true)))
            .expect("client module transform");
        let client_trace: crate::semantic_trace::ServerFunctionSemanticTrace =
            serde_json::from_str(
                client
                    .semantic_trace
                    .as_deref()
                    .expect("client module trace"),
            )
            .expect("typed client module trace");
        let client_function = &client_trace.functions[0];
        assert_eq!(client_function.id, function.id);
        assert_eq!(client_function.exports, function.exports);
        assert_eq!(client_function.source_span, function.source_span);
        assert_eq!(client_function.directive_span, function.directive_span);
        assert!(!client_function.registers_server_implementation);
    }
}

fn import_def(option: Option<&DirectiveImportOption>, default_name: &str) -> ImportDef {
    match option {
        Some(option) => ImportDef {
            kind: if option.kind.as_deref() == Some("default") {
                ImportKind::Default
            } else {
                ImportKind::Named
            },
            name: option
                .name
                .clone()
                .unwrap_or_else(|| default_name.to_string()),
            source: option.source.clone(),
        },
        None => ImportDef {
            kind: ImportKind::Named,
            name: default_name.to_string(),
            source: DEFAULT_RUNTIME.to_string(),
        },
    }
}

/// Node's `path.relative(root, id)` with separators normalized to `/` — the
/// hash input contract shared with the Babel implementation's `compile()`.
/// Also reused by the refresh pass for cwd-relative `location` strings.
pub(crate) fn relative_id(root: Option<&str>, filename: &str) -> String {
    let cwd = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("/"));
    let root = normalize(&cwd, root.map(std::path::Path::new).unwrap_or(&cwd));
    let file = normalize(&cwd, std::path::Path::new(filename));

    let mut root_parts = root.iter().peekable();
    let mut file_parts = file.iter().peekable();
    while let (Some(a), Some(b)) = (root_parts.peek(), file_parts.peek()) {
        if a != b {
            break;
        }
        root_parts.next();
        file_parts.next();
    }
    let mut parts: Vec<String> = Vec::new();
    for _ in root_parts {
        parts.push("..".to_string());
    }
    for part in file_parts {
        parts.push(part.to_string_lossy().into_owned());
    }
    parts.join("/")
}

/// Resolve against `cwd` and fold `.`/`..` segments (Node `path.resolve`).
fn normalize(cwd: &std::path::Path, path: &std::path::Path) -> std::path::PathBuf {
    let joined = if path.is_absolute() {
        path.to_path_buf()
    } else {
        cwd.join(path)
    };
    let mut result = std::path::PathBuf::new();
    for component in joined.components() {
        match component {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                result.pop();
            }
            other => result.push(other.as_os_str()),
        }
    }
    result
}
