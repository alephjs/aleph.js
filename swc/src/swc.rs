// Copyright 2018-2020 the Deno authors. All rights reserved. MIT license.
// Copyright 2020 the Aleph.js authors. All rights reserved. MIT license.

use crate::jsx::aleph_swc_jsx;
use crate::resolve::{aleph_resolve_vistor, ImportHashMap, ImportMap, Resolver};
use crate::source_type::SourceType;

use std::error::Error;
use std::fmt;
use std::path::Path;
use std::rc::Rc;
use std::sync::Arc;
use std::sync::RwLock;
use swc_common::{
  chain,
  comments::{Comment, SingleThreadedComments},
  errors::{Diagnostic, DiagnosticBuilder, Emitter, Handler, HandlerFlags},
  FileName, Globals, Loc, SourceMap, Span,
};
use swc_ecmascript::ast::{Module, Program};
use swc_ecmascript::codegen::{text_writer::JsWriter, Node};
use swc_ecmascript::dep_graph::{analyze_dependencies, DependencyDescriptor};
use swc_ecmascript::parser::lexer::Lexer;
use swc_ecmascript::parser::{EsConfig, JscTarget, StringInput, Syntax, TsConfig};
use swc_ecmascript::transforms::{fixer, helpers, proposals, react, typescript};
use swc_ecmascript::visit::FoldWith;

/// Options which can be adjusted when transpiling a module.
#[derive(Debug, Clone)]
pub struct EmitOptions {
  /// When transforming JSX, what value should be used for the JSX factory.
  /// Defaults to `React.createElement`.
  pub jsx_factory: String,
  /// When transforming JSX, what value should be used for the JSX fragment
  /// factory.  Defaults to `React.Fragment`.
  pub jsx_fragment_factory: String,
  /// Should JSX be transformed or preserved.  Defaults to `true`.
  pub minify: bool,
}

impl Default for EmitOptions {
  fn default() -> Self {
    EmitOptions {
      jsx_factory: "React.createElement".into(),
      jsx_fragment_factory: "React.Fragment".into(),
      minify: false,
    }
  }
}

fn get_es_config(jsx: bool) -> EsConfig {
  EsConfig {
    class_private_methods: true,
    class_private_props: true,
    class_props: true,
    dynamic_import: true,
    export_default_from: true,
    export_namespace_from: true,
    import_meta: true,
    jsx,
    nullish_coalescing: true,
    num_sep: true,
    optional_chaining: true,
    top_level_await: true,
    ..EsConfig::default()
  }
}

fn get_ts_config(tsx: bool) -> TsConfig {
  TsConfig {
    tsx,
    decorators: true,
    dynamic_import: true,
    ..TsConfig::default()
  }
}

pub fn get_syntax(media_type: &SourceType) -> Syntax {
  match media_type {
    SourceType::JavaScript => Syntax::Es(get_es_config(false)),
    SourceType::JSX => Syntax::Es(get_es_config(true)),
    SourceType::TypeScript => Syntax::Typescript(get_ts_config(false)),
    SourceType::TSX => Syntax::Typescript(get_ts_config(true)),
    _ => Syntax::Es(get_es_config(false)),
  }
}

/// A buffer for collecting diagnostic messages from the AST parser.
#[derive(Debug)]
pub struct DiagnosticBuffer(Vec<String>);

impl Error for DiagnosticBuffer {}

impl fmt::Display for DiagnosticBuffer {
  fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
    let s = self.0.join(",");
    f.pad(&s)
  }
}

impl DiagnosticBuffer {
  pub fn from_error_buffer<F>(error_buffer: ErrorBuffer, get_loc: F) -> Self
  where
    F: Fn(Span) -> Loc,
  {
    let s = error_buffer.0.read().unwrap().clone();
    let diagnostics = s
      .iter()
      .map(|d| {
        let mut msg = d.message();

        if let Some(span) = d.span.primary_span() {
          let loc = get_loc(span);
          let file_name = match &loc.file.name {
            FileName::Real(p) => p.display(),
            _ => unreachable!(),
          };
          msg = format!("{} at {}:{}:{}", msg, file_name, loc.line, loc.col_display);
        }

        msg
      })
      .collect::<Vec<String>>();

    Self(diagnostics)
  }
}

/// A buffer for collecting errors from the AST parser.
#[derive(Debug, Clone)]
pub struct ErrorBuffer(Arc<RwLock<Vec<Diagnostic>>>);

impl ErrorBuffer {
  pub fn new() -> Self {
    Self(Arc::new(RwLock::new(Vec::new())))
  }
}

impl Emitter for ErrorBuffer {
  fn emit(&mut self, db: &DiagnosticBuilder) {
    self.0.write().unwrap().push((**db).clone());
  }
}

/// A logical structure to hold the value of a parsed module for further
/// processing.
#[derive(Clone)]
pub struct ParsedModule {
  comments: SingleThreadedComments,
  leading_comments: Vec<Comment>,
  module: Module,
  source_map: Rc<SourceMap>,
  resolver: Rc<Resolver>,
}

impl fmt::Debug for ParsedModule {
  fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
    f.debug_struct("ParsedModule")
      .field("comments", &self.comments)
      .field("leading_comments", &self.leading_comments)
      .field("module", &self.module)
      .finish()
  }
}

impl ParsedModule {
  /// Return a vector of dependencies for the module.
  pub fn analyze_dependencies(&self) -> Vec<DependencyDescriptor> {
    analyze_dependencies(&self.module, &self.source_map, &self.comments)
  }

  /// Transform a TypeScript file into a JavaScript file, based on the supplied
  /// options.
  ///
  /// The result is a tuple of the code and optional source map as strings.
  pub fn transpile(self, options: &EmitOptions) -> Result<(String, Option<String>), anyhow::Error> {
    let program = Program::Module(self.module);
    let swc_jsx_pass = react::react(
      self.source_map.clone(),
      Some(&self.comments),
      react::Options {
        pragma: options.jsx_factory.clone(),
        pragma_frag: options.jsx_fragment_factory.clone(),
        // this will use `Object.assign()` instead of the `_extends` helper
        // when spreading props.
        use_builtins: true,
        ..Default::default()
      },
    );
    let mut passes = chain!(
      aleph_resolve_vistor(self.resolver.clone()),
      aleph_swc_jsx(
        self.resolver.clone(),
        self.source_map.clone(),
        !options.minify
      ),
      swc_jsx_pass,
      proposals::decorators::decorators(proposals::decorators::Config {
        legacy: true,
        emit_metadata: false
      }),
      typescript::strip(),
      fixer(Some(&self.comments)),
    );

    let program = swc_common::GLOBALS.set(&Globals::new(), || {
      helpers::HELPERS.set(&helpers::Helpers::new(false), || {
        program.fold_with(&mut passes)
      })
    });

    let mut src_map_buf = vec![];
    let mut buf = vec![];
    {
      let writer = Box::new(JsWriter::new(
        self.source_map.clone(),
        "\n",
        &mut buf,
        Some(&mut src_map_buf),
      ));
      let mut emitter = swc_ecmascript::codegen::Emitter {
        cfg: swc_ecmascript::codegen::Config {
          minify: options.minify,
        },
        comments: Some(&self.comments),
        cm: self.source_map.clone(),
        wr: writer,
      };
      program.emit_with(&mut emitter)?;
    }
    let src = String::from_utf8(buf)?;
    let mut buf = Vec::new();
    self
      .source_map
      .build_source_map_from(&mut src_map_buf, None)
      .to_writer(&mut buf)?;
    Ok((src, Some(String::from_utf8(buf)?)))
  }
}

/// For a given specifier, source, and media type, parse the source of the
/// module and return a representation which can be further processed.
///
/// # Arguments
///
/// - `specifier` - The module specifier for the module.
/// - `source` - The source code for the module.
/// - `target` - The target for the module.
///
// NOTE(bartlomieju): `specifier` has `&str` type instead of
// `&ModuleSpecifier` because runtime compiler APIs don't
// require valid module specifiers
pub fn parse(
  specifier: &str,
  source: &str,
  import_map: ImportHashMap,
  target: JscTarget,
) -> Result<ParsedModule, anyhow::Error> {
  let resolver = Resolver::new(ImportMap::from_hashmap(import_map), false);
  let source_map = SourceMap::default();
  let source_file = source_map.new_source_file(
    FileName::Real(Path::new(specifier).to_path_buf()),
    source.to_string(),
  );
  let error_buffer = ErrorBuffer::new();
  let media_type = &SourceType::from(Path::new(specifier));
  let syntax = get_syntax(media_type);
  let input = StringInput::from(&*source_file);
  let comments = SingleThreadedComments::default();

  let handler = Handler::with_emitter_and_flags(
    Box::new(error_buffer.clone()),
    HandlerFlags {
      can_emit_warnings: true,
      dont_buffer_diagnostics: true,
      ..HandlerFlags::default()
    },
  );

  let lexer = Lexer::new(syntax, target, input, Some(&comments));
  let mut parser = swc_ecmascript::parser::Parser::new_from(lexer);

  let sm = &source_map;
  let module = parser.parse_module().map_err(move |err| {
    let mut diagnostic = err.into_diagnostic(&handler);
    diagnostic.emit();
    DiagnosticBuffer::from_error_buffer(error_buffer, |span| sm.lookup_char_pos(span.lo))
  })?;
  let leading_comments = comments.with_leading(module.span.lo, |comments| comments.to_vec());

  Ok(ParsedModule {
    leading_comments,
    module,
    source_map: Rc::new(source_map),
    resolver: Rc::new(resolver),
    comments,
  })
}

#[cfg(test)]
mod tests {
  use super::*;
  use swc_ecmascript::dep_graph::DependencyKind;

  #[test]
  fn test_parsed_module_analyze_dependencies() {
    let source = r#"import * as bar from "./test.ts";
    const foo = await import("./foo.ts");
    "#;
    let parsed_module = parse(
      "https://deno.land/x/mod.js",
      source,
      ImportHashMap::default(),
      JscTarget::Es2020,
    )
    .expect("could not parse module");
    let actual = parsed_module.analyze_dependencies();
    assert_eq!(
      actual,
      vec![
        DependencyDescriptor {
          kind: DependencyKind::Import,
          is_dynamic: false,
          leading_comments: Vec::new(),
          col: 0,
          line: 1,
          specifier: "./test.ts".into()
        },
        DependencyDescriptor {
          kind: DependencyKind::Import,
          is_dynamic: true,
          leading_comments: Vec::new(),
          col: 22,
          line: 2,
          specifier: "./foo.ts".into()
        }
      ]
    );
  }

  #[test]
  fn test_transpile() {
    let source = r#"
    enum D {
      A,
      B,
      C,
    }

    export class A {
      private b: string;
      protected c: number = 1;
      e: "foo";
      constructor (public d = D.A) {
        const e = "foo" as const;
        this.e = e;
      }
    }
    "#;
    let module = parse(
      "https://deno.land/x/mod.ts",
      source,
      ImportHashMap::default(),
      JscTarget::Es2020,
    )
    .expect("could not parse module");
    let (code, maybe_map) = module
      .transpile(&EmitOptions::default())
      .expect("could not strip types");
    assert!(code.starts_with("var D;\n(function(D) {\n"));
    assert!(code.contains("\n//# sourceMappingURL=data:application/json;base64,"));
    assert!(maybe_map.is_none());
  }

  #[test]
  fn test_transpile_tsx() {
    let source = r#"
    export class A {
      render() {
        return <div><span></span></div>
      }
    }
    "#;
    let module = parse(
      "https://deno.land/x/mod.tsx",
      source,
      ImportHashMap::default(),
      JscTarget::Es2020,
    )
    .expect("could not parse module");
    let (code, _) = module
      .transpile(&EmitOptions::default())
      .expect("could not strip types");
    assert!(code.contains("React.createElement(\"div\", null"));
  }

  #[test]
  fn test_transpile_decorators() {
    let source = r#"
    function enumerable(value: boolean) {
      return function (
        _target: any,
        _propertyKey: string,
        descriptor: PropertyDescriptor,
      ) {
        descriptor.enumerable = value;
      };
    }

    export class A {
      @enumerable(false)
      a() {
        Test.value;
      }
    }
    "#;
    let module = parse(
      "https://deno.land/x/mod.ts",
      source,
      ImportHashMap::default(),
      JscTarget::Es2020,
    )
    .expect("could not parse module");
    let (code, _) = module
      .transpile(&EmitOptions::default())
      .expect("could not strip types");
    assert!(code.contains("_applyDecoratedDescriptor("));
  }
}
