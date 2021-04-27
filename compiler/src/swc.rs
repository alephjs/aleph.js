use crate::error::{DiagnosticBuffer, ErrorBuffer};
use crate::fast_refresh::react_refresh_fold;
use crate::import_map::ImportHashMap;
use crate::jsx::aleph_jsx_fold;
use crate::resolve::Resolver;
use crate::resolve_fold::{resolve_fold, ExportsParser};
use crate::source_type::SourceType;

use std::{cell::RefCell, cmp::min, path::Path, rc::Rc};
use swc_common::{
  chain,
  comments::SingleThreadedComments,
  errors::{Handler, HandlerFlags},
  FileName, Globals, SourceMap,
};
use swc_ecma_transforms_proposal::decorators;
use swc_ecma_transforms_typescript::strip;
use swc_ecmascript::{
  ast::{Module, Program},
  codegen::{text_writer::JsWriter, Node},
  parser::{lexer::Lexer, EsConfig, JscTarget, StringInput, Syntax, TsConfig},
  transforms::{fixer, helpers, hygiene, pass::Optional, react},
  visit::{Fold, FoldWith},
};

/// Options for transpiling a module.
#[derive(Debug, Clone)]
pub struct EmitOptions {
  pub jsx_factory: String,
  pub jsx_fragment_factory: String,
  pub source_map: bool,
  pub is_dev: bool,
}

impl Default for EmitOptions {
  fn default() -> Self {
    EmitOptions {
      jsx_factory: "React.createElement".into(),
      jsx_fragment_factory: "React.Fragment".into(),
      is_dev: false,
      source_map: false,
    }
  }
}

#[derive(Clone)]
pub struct SWC {
  pub specifier: String,
  pub module: Module,
  pub source_type: SourceType,
  pub source_map: Rc<SourceMap>,
  pub comments: SingleThreadedComments,
}

impl SWC {
  /// parse the source of the module.
  ///
  /// ### Arguments
  ///
  /// - `specifier` - The module specifier for the module.
  /// - `source` - The source code for the module.
  /// - `target` - The target for the module.
  ///
  pub fn parse(
    specifier: &str,
    source: &str,
    source_type: Option<SourceType>,
  ) -> Result<Self, anyhow::Error> {
    let source_map = SourceMap::default();
    let source_file = source_map.new_source_file(
      FileName::Real(Path::new(specifier).to_path_buf()),
      source.into(),
    );
    let sm = &source_map;
    let error_buffer = ErrorBuffer::new(specifier);
    let source_type = match source_type {
      Some(source_type) => match source_type {
        SourceType::Unknown => SourceType::from(Path::new(specifier)),
        _ => source_type,
      },
      None => SourceType::from(Path::new(specifier)),
    };
    let syntax = get_syntax(&source_type);
    let input = StringInput::from(&*source_file);
    let comments = SingleThreadedComments::default();
    let lexer = Lexer::new(syntax, JscTarget::Es2020, input, Some(&comments));
    let mut parser = swc_ecmascript::parser::Parser::new_from(lexer);
    let handler = Handler::with_emitter_and_flags(
      Box::new(error_buffer.clone()),
      HandlerFlags {
        can_emit_warnings: true,
        dont_buffer_diagnostics: true,
        ..HandlerFlags::default()
      },
    );
    let module = parser
      .parse_module()
      .map_err(move |err| {
        let mut diagnostic = err.into_diagnostic(&handler);
        diagnostic.emit();
        DiagnosticBuffer::from_error_buffer(error_buffer, |span| sm.lookup_char_pos(span.lo))
      })
      .unwrap();

    Ok(SWC {
      specifier: specifier.into(),
      module,
      source_type,
      source_map: Rc::new(source_map),
      comments,
    })
  }

  /// transform a JS/TS/JSX/TSX file into a JS file, based on the supplied options.
  ///
  /// ### Arguments
  ///
  /// - `resolver` - a resolver to resolve import/export url.
  /// - `options` - the options for emit code.
  ///
  pub fn transform(
    self,
    resolver: Rc<RefCell<Resolver>>,
    options: &EmitOptions,
  ) -> Result<(String, Option<String>), anyhow::Error> {
    swc_common::GLOBALS.set(&Globals::new(), || {
      let specifier_is_remote = resolver.borrow().specifier_is_remote;
      let is_ts = match self.source_type {
        SourceType::TS => true,
        SourceType::TSX => true,
        _ => false,
      };
      let is_jsx = match self.source_type {
        SourceType::JSX => true,
        SourceType::TSX => true,
        _ => false,
      };
      let (aleph_jsx_fold, aleph_jsx_builtin_resolve_fold) =
        aleph_jsx_fold(resolver.clone(), self.source_map.clone(), options.is_dev);
      let mut passes = chain!(
        resolve_fold(resolver.clone(), self.source_map.clone(), !options.is_dev),
        Optional::new(aleph_jsx_fold, is_jsx),
        Optional::new(aleph_jsx_builtin_resolve_fold, is_jsx),
        Optional::new(
          react_refresh_fold(
            "$RefreshReg$",
            "$RefreshSig$",
            false,
            self.source_map.clone()
          ),
          options.is_dev && !specifier_is_remote
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
          is_jsx
        ),
        decorators::decorators(decorators::Config {
          legacy: true,
          emit_metadata: false
        }),
        helpers::inject_helpers(),
        Optional::new(strip(), is_ts),
        fixer(Some(&self.comments)),
        hygiene()
      );

      self.apply_transform(&mut passes, options.source_map)
    })
  }

  pub fn parse_export_names(&self) -> Result<Vec<String>, anyhow::Error> {
    let program = Program::Module(self.module.clone());
    let mut parser = ExportsParser { names: vec![] };
    program.fold_with(&mut parser);
    Ok(parser.names)
  }

  /// Apply transform with fold.
  pub fn apply_transform<T: Fold>(
    &self,
    mut tr: T,
    source_map: bool,
  ) -> Result<(String, Option<String>), anyhow::Error> {
    let program = Program::Module(self.module.clone());
    let program =
      helpers::HELPERS.set(&helpers::Helpers::new(false), || program.fold_with(&mut tr));
    let mut buf = Vec::new();
    let mut src_map_buf = Vec::new();
    let src_map = if source_map {
      Some(&mut src_map_buf)
    } else {
      None
    };
    {
      let writer = Box::new(JsWriter::new(
        self.source_map.clone(),
        "\n",
        &mut buf,
        src_map,
      ));
      let mut emitter = swc_ecmascript::codegen::Emitter {
        cfg: swc_ecmascript::codegen::Config {
          minify: false, // todo: use swc minify in the future, currently use terser
        },
        comments: Some(&self.comments),
        cm: self.source_map.clone(),
        wr: writer,
      };
      program.emit_with(&mut emitter).unwrap();
    }

    // output
    let src = String::from_utf8(buf).unwrap();
    if source_map {
      let mut buf = Vec::new();
      self
        .source_map
        .build_source_map_from(&mut src_map_buf, None)
        .to_writer(&mut buf)
        .unwrap();
      Ok((src, Some(String::from_utf8(buf).unwrap())))
    } else {
      Ok((src, None))
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
    num_sep: true,
    nullish_coalescing: true,
    optional_chaining: true,
    top_level_await: true,
    import_meta: true,
    import_assertions: true,
    jsx,
    ..EsConfig::default()
  }
}

fn get_ts_config(tsx: bool) -> TsConfig {
  TsConfig {
    decorators: true,
    dynamic_import: true,
    tsx,
    ..TsConfig::default()
  }
}

fn get_syntax(source_type: &SourceType) -> Syntax {
  match source_type {
    SourceType::JS => Syntax::Es(get_es_config(false)),
    SourceType::JSX => Syntax::Es(get_es_config(true)),
    SourceType::TS => Syntax::Typescript(get_ts_config(false)),
    SourceType::TSX => Syntax::Typescript(get_ts_config(true)),
    _ => Syntax::Es(get_es_config(false)),
  }
}

#[allow(dead_code)]
pub fn t<T: Fold>(specifier: &str, source: &str, tr: T, expect: &str) -> bool {
  let module = SWC::parse(specifier, source, None).expect("could not parse module");
  let (code, _) = swc_common::GLOBALS.set(&Globals::new(), || {
    module
      .apply_transform(tr, false)
      .expect("could not transpile module")
  });
  let matched = code.as_str().trim().eq(expect.trim());

  if !matched {
    let mut p: usize = 0;
    for i in 0..min(code.len(), expect.len()) {
      if code.get(i..i + 1) != expect.get(i..i + 1) {
        p = i;
        break;
      }
    }
    println!(
      "{}\x1b[0;31m{}\x1b[0m",
      code.get(0..p).unwrap(),
      code.get(p..).unwrap()
    );
  }
  matched
}

#[allow(dead_code)]
pub fn st(specifer: &str, source: &str, bundle_mode: bool) -> (String, Rc<RefCell<Resolver>>) {
  let module = SWC::parse(specifer, source, None).expect("could not parse module");
  let resolver = Rc::new(RefCell::new(Resolver::new(
    specifer,
    ImportHashMap::default(),
    bundle_mode,
    vec![],
    Some("https://deno.land/x/aleph@v0.3.0".into()),
    None,
  )));
  let (code, _) = module
    .transform(resolver.clone(), &EmitOptions::default())
    .expect("could not transform module");
  println!("{}", code);
  (code, resolver)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn ts() {
    let source = r#"
      enum D {
        A,
        B,
        C,
      }

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
        private b: string;
        protected c: number = 1;
        e: "foo";
        constructor (public d = D.A) {
          const e = "foo" as const;
          this.e = e;
        }
        @enumerable(false)
        bar() {}
      }
    "#;
    let (code, _) = st("https://deno.land/x/mod.ts", source, false);
    assert!(code.contains("var D;\n(function(D) {\n"));
    assert!(code.contains("_applyDecoratedDescriptor("));
  }

  #[test]
  fn jsx() {
    let source = r#"
      import React from "https://esm.sh/react"
      export default function Index() {
        return (
          <>
            <h1 className="title">Hello World</h1>
          </>
        )
      }
    "#;
    let (code, _) = st("/pages/index.tsx", source, false);
    assert!(code.contains("React.createElement(React.Fragment, null"));
    assert!(code.contains("React.createElement(\"h1\", {"));
    assert!(code.contains("className: \"title\""));
  }
}
