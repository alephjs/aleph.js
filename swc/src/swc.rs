// Copyright 2018-2020 the Deno authors. All rights reserved. MIT license.
// Copyright 2020 the Aleph.js authors. All rights reserved. MIT license.

use crate::error::{DiagnosticBuffer, ErrorBuffer};
use crate::jsx::aleph_swc_jsx_fold;
use crate::resolve::{aleph_resolve_fold, Resolver};
use crate::source_type::SourceType;

use std::fmt;
use std::path::Path;
use std::rc::Rc;
use swc_common::{
  chain,
  comments::{Comment, SingleThreadedComments},
  errors::{Handler, HandlerFlags},
  FileName, Globals, SourceMap,
};
use swc_ecmascript::ast::{Module, Program};
use swc_ecmascript::codegen::{text_writer::JsWriter, Node};
use swc_ecmascript::parser::lexer::Lexer;
use swc_ecmascript::parser::{EsConfig, JscTarget, StringInput, Syntax, TsConfig};
use swc_ecmascript::transforms::{fixer, helpers, pass::Optional, proposals, react, typescript};
use swc_ecmascript::visit::FoldWith;

/// Options which can be adjusted when transpiling a module.
#[derive(Debug, Clone)]
pub struct EmitOptions {
  pub jsx_factory: String,
  pub jsx_fragment_factory: String,
  pub is_dev: bool,
}

impl Default for EmitOptions {
  fn default() -> Self {
    EmitOptions {
      jsx_factory: "React.createElement".into(),
      jsx_fragment_factory: "React.Fragment".into(),
      is_dev: true,
    }
  }
}

/// A logical structure to hold the value of a parsed module for further processing.
#[derive(Clone)]
pub struct ParsedModule {
  comments: SingleThreadedComments,
  leading_comments: Vec<Comment>,
  module: Module,
  source_type: SourceType,
  source_map: Rc<SourceMap>,
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
  /// Transform a TypeScript file into a JavaScript file, based on the supplied
  /// options.
  ///
  /// The result is a tuple of the code and optional source map as strings.
  pub fn transpile(
    self,
    resolver: Rc<Resolver>,
    options: &EmitOptions,
  ) -> Result<(String, Option<String>), anyhow::Error> {
    let program = Program::Module(self.module);
    let jsx = match self.source_type {
      SourceType::JSX => true,
      SourceType::TSX => true,
      _ => false,
    };
    let ts = match self.source_type {
      SourceType::TypeScript => true,
      SourceType::TSX => true,
      _ => false,
    };

    let mut passes = chain!(
      aleph_resolve_fold(resolver.clone()),
      Optional::new(
        aleph_swc_jsx_fold(resolver.clone(), self.source_map.clone(), options.is_dev),
        jsx
      ),
      Optional::new(
        react::jsx(
          self.source_map.clone(),
          Some(&self.comments),
          react::Options {
            pragma: options.jsx_factory.clone(),
            pragma_frag: options.jsx_fragment_factory.clone(),
            // this will use `Object.assign()` instead of the `_extends` helper when spreading props.
            use_builtins: true,
            ..Default::default()
          },
        ),
        jsx
      ),
      proposals::decorators::decorators(proposals::decorators::Config {
        legacy: true,
        emit_metadata: false
      }),
      helpers::inject_helpers(),
      Optional::new(typescript::strip(), ts),
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
          minify: false, // use swc minify in the future, currently use terser
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
/// ## Arguments
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
  target: JscTarget,
) -> Result<ParsedModule, anyhow::Error> {
  let source_map = SourceMap::default();
  let source_file = source_map.new_source_file(
    FileName::Real(Path::new(specifier).to_path_buf()),
    source.to_string(),
  );
  let sm = &source_map;
  let error_buffer = ErrorBuffer::new();
  let source_type = SourceType::from(Path::new(specifier));
  let syntax = get_syntax(&source_type);
  let input = StringInput::from(&*source_file);
  let comments = SingleThreadedComments::default();

  let lexer = Lexer::new(syntax, target, input, Some(&comments));
  let mut parser = swc_ecmascript::parser::Parser::new_from(lexer);

  let handler = Handler::with_emitter_and_flags(
    Box::new(error_buffer.clone()),
    HandlerFlags {
      can_emit_warnings: true,
      dont_buffer_diagnostics: true,
      ..HandlerFlags::default()
    },
  );
  let module = parser.parse_module().map_err(move |err| {
    let mut diagnostic = err.into_diagnostic(&handler);
    diagnostic.emit();
    DiagnosticBuffer::from_error_buffer(error_buffer, |span| sm.lookup_char_pos(span.lo))
  })?;
  let leading_comments = comments.with_leading(module.span.lo, |comments| comments.to_vec());

  Ok(ParsedModule {
    leading_comments,
    module,
    source_type,
    source_map: Rc::new(source_map),
    comments,
  })
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

fn get_syntax(source_type: &SourceType) -> Syntax {
  match source_type {
    SourceType::JavaScript => Syntax::Es(get_es_config(false)),
    SourceType::JSX => Syntax::Es(get_es_config(true)),
    SourceType::TypeScript => Syntax::Typescript(get_ts_config(false)),
    SourceType::TSX => Syntax::Typescript(get_ts_config(true)),
    _ => Syntax::Es(get_es_config(false)),
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::import_map::{ImportHashMap, ImportMap};
  use crate::resolve::Resolver;

  #[test]
  fn test_transpile_ts() {
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
    let module = parse("https://deno.land/x/mod.ts", source, JscTarget::Es2020)
      .expect("could not parse module");
    let (code, maybe_map) = module
      .transpile(
        Rc::new(Resolver::new(
          ".",
          ImportMap::from_hashmap(ImportHashMap::default()),
          true,
          false,
        )),
        &EmitOptions::default(),
      )
      .expect("could not strip types");
    assert!(code.starts_with("var D;\n(function(D) {\n"));
    assert!(!maybe_map.is_none());
  }

  #[test]
  fn test_transpile_jsx() {
    let source = r#"
    export default function Hi() {
      return <><h1>Hello World</h1></>
    }
    "#;
    let module = parse("https://deno.land/x/mod.tsx", source, JscTarget::Es2020)
      .expect("could not parse module");
    let (code, _) = module
      .transpile(
        Rc::new(Resolver::new(
          ".",
          ImportMap::from_hashmap(ImportHashMap::default()),
          true,
          false,
        )),
        &EmitOptions {
          jsx_factory: "h".into(),
          jsx_fragment_factory: "Fragment".into(),
          is_dev: true,
        },
      )
      .expect("could not strip types");
    assert!(code.contains("h(\"h1\", {"));
    assert!(code.contains("h(Fragment, null"));
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
      a() {}
    }
    "#;
    let module = parse("https://deno.land/x/mod.ts", source, JscTarget::Es2020)
      .expect("could not parse module");
    let (code, _) = module
      .transpile(
        Rc::new(Resolver::new(
          ".",
          ImportMap::from_hashmap(ImportHashMap::default()),
          true,
          false,
        )),
        &EmitOptions::default(),
      )
      .expect("could not strip types");

    assert!(code.contains("_applyDecoratedDescriptor("));
  }
}
