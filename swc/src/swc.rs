// Copyright 2018-2020 the Deno authors. All rights reserved. MIT license.
// Copyright 2020 the Aleph.js authors. All rights reserved. MIT license.

use crate::error::{DiagnosticBuffer, ErrorBuffer};
use crate::fast_refresh::fast_refresh_fold;
use crate::jsx::aleph_jsx_fold;
use crate::resolve::{aleph_resolve_fold, Resolver};
use crate::source_type::SourceType;

use std::{cell::RefCell, path::Path, rc::Rc};
use swc_common::{
  chain,
  comments::SingleThreadedComments,
  errors::{Handler, HandlerFlags},
  FileName, Globals, SourceMap,
};
use swc_ecmascript::{
  ast::{Module, Program},
  codegen::{text_writer::JsWriter, Node},
  parser::lexer::Lexer,
  parser::{EsConfig, JscTarget, StringInput, Syntax, TsConfig},
  transforms::{fixer, helpers, pass::Optional, proposals, react, typescript},
  visit::{Fold, FoldWith},
};

/// Options for transpiling a module.
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

#[derive(Clone)]
pub struct ParsedModule {
  pub specifier: String,
  pub module: Module,
  pub source_type: SourceType,
  pub source_map: Rc<SourceMap>,
  pub comments: SingleThreadedComments,
}

impl ParsedModule {
  /// parse the source of the module.
  ///
  /// ### Arguments
  ///
  /// - `specifier` - The module specifier for the module.
  /// - `source` - The source code for the module.
  /// - `target` - The target for the module.
  ///
  pub fn parse(specifier: &str, source: &str, target: JscTarget) -> Result<Self, anyhow::Error> {
    let source_map = SourceMap::default();
    let source_file = source_map.new_source_file(
      FileName::Real(Path::new(specifier).to_path_buf()),
      source.into(),
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
    let module = parser
      .parse_module()
      .map_err(move |err| {
        let mut diagnostic = err.into_diagnostic(&handler);
        diagnostic.emit();
        DiagnosticBuffer::from_error_buffer(error_buffer, |span| sm.lookup_char_pos(span.lo))
      })
      .unwrap();

    Ok(ParsedModule {
      specifier: specifier.into(),
      module,
      source_type,
      source_map: Rc::new(source_map),
      comments,
    })
  }

  /// Transform a JS/TS/JSX file into a JS file, based on the supplied options.
  ///
  /// ### Arguments
  ///
  /// - `resolver` - a resolver to resolve import/export url.
  /// - `options` - the options for emit code.
  ///
  pub fn transpile(
    self,
    resolver: Rc<RefCell<Resolver>>,
    options: &EmitOptions,
  ) -> Result<(String, Option<String>), anyhow::Error> {
    let is_remote_module = resolver.borrow_mut().is_remote_module();
    let ts = match self.source_type {
      SourceType::TypeScript => true,
      SourceType::TSX => true,
      _ => false,
    };
    let jsx = match self.source_type {
      SourceType::JSX => true,
      SourceType::TSX => true,
      _ => false,
    };

    let mut passes = chain!(
      aleph_resolve_fold(resolver.clone()),
      Optional::new(
        fast_refresh_fold(
          "$RefreshReg$",
          "$RefreshSig$",
          false,
          self.source_map.clone()
        ),
        options.is_dev && !is_remote_module
      ),
      Optional::new(
        aleph_jsx_fold(
          resolver.clone(),
          self.source_map.clone(),
          options.is_dev && !is_remote_module
        ),
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

    self.apply_transform(&mut passes)
  }

  /// Apply transform with fold.
  pub fn apply_transform<T: Fold>(
    &self,
    mut tr: T,
  ) -> Result<(String, Option<String>), anyhow::Error> {
    let program = Program::Module(self.module.clone());
    let program = swc_common::GLOBALS.set(&Globals::new(), || {
      helpers::HELPERS.set(&helpers::Helpers::new(false), || program.fold_with(&mut tr))
    });
    let mut buf = vec![];
    let mut src_map_buf = vec![];
    {
      let writer = Box::new(JsWriter::new(
        self.source_map.clone(),
        "\n",
        &mut buf,
        Some(&mut src_map_buf),
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
    let src = String::from_utf8(buf).unwrap();
    let mut buf = Vec::new();
    self
      .source_map
      .build_source_map_from(&mut src_map_buf, None)
      .to_writer(&mut buf)
      .unwrap();
    Ok((src, Some(String::from_utf8(buf).unwrap())))
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
  use crate::resolve::{DependencyDescriptor, Resolver};

  #[test]
  fn test_transpile_ts() {
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
    let module = ParsedModule::parse("https://deno.land/x/mod.ts", source, JscTarget::Es2020)
      .expect("could not parse module");
    let resolver = Rc::new(RefCell::new(Resolver::new(
      "https://deno.land/x/mod.ts",
      ImportMap::from_hashmap(ImportHashMap::default()),
      false,
      false,
    )));
    let (code, maybe_map) = module
      .transpile(resolver.clone(), &EmitOptions::default())
      .expect("could not transpile module");
    println!("{}", code);
    assert!(code.contains("var D;\n(function(D) {\n"));
    assert!(code.contains("_applyDecoratedDescriptor("));
    assert!(!maybe_map.is_none());
  }

  #[test]
  fn test_transpile_jsx() {
    let source = r#"
    import React, { useState } from "https://esm.sh/react"
    export default function Index() {
      const [count, setCount] = useState(0)
      useEffect(() => {}, [])
      return (
        <>
          <Import from="../components/logo.tsx" />
          <h1>Hello World</h1>
        </>
      )
    }
    "#;
    let module = ParsedModule::parse("/pages/index.tsx", source, JscTarget::Es2020)
      .expect("could not parse module");
    let resolver = Rc::new(RefCell::new(Resolver::new(
      "/pages/index.tsx",
      ImportMap::from_hashmap(ImportHashMap::default()),
      false,
      false,
    )));
    let (code, _) = module
      .transpile(resolver.clone(), &EmitOptions::default())
      .expect("could not transpile module");
    println!("{}", code);
    assert!(code.contains("React.createElement(\"h1\", {"));
    assert!(code.contains("React.createElement(React.Fragment, null"));
    assert!(code.contains("__source: {"));
    assert!(code.contains("import React, { useState } from \"../-/esm.sh/react.js\""));
    assert!(code.contains("from: \"../components/logo.js\""));
    let r = resolver.borrow_mut();
    assert_eq!(
      r.dep_graph,
      vec![
        DependencyDescriptor {
          specifier: "https://esm.sh/react".into(),
          is_dynamic: false,
        },
        DependencyDescriptor {
          specifier: "/components/logo.tsx".into(),
          is_dynamic: true,
        }
      ]
    );
  }
}
