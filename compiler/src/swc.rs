// Copyright 2018-2020 the Deno authors. All rights reserved. MIT license.
// Copyright 2020-2021 postUI Lab. All rights reserved. MIT license.

use crate::compat_fixer::compat_fixer_fold;
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
  FileName, Globals, Mark, SourceMap,
};
use swc_ecma_transforms_compat::{es2015, es2016, es2017, es2018, es2020};
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
  pub target: JscTarget,
  pub jsx_factory: String,
  pub jsx_fragment_factory: String,
  pub is_dev: bool,
  pub source_map: bool,
}

impl Default for EmitOptions {
  fn default() -> Self {
    EmitOptions {
      target: JscTarget::Es2020,
      jsx_factory: "React.createElement".into(),
      jsx_fragment_factory: "React.Fragment".into(),
      is_dev: false,
      source_map: false,
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
    let error_buffer = ErrorBuffer::new();
    let source_type = match source_type {
      Some(source_type) => source_type,
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
    swc_common::GLOBALS.set(&Globals::new(), || {
      let specifier_is_remote = resolver.borrow_mut().specifier_is_remote;
      let is_ts = match self.source_type {
        SourceType::TypeScript => true,
        SourceType::TSX => true,
        _ => false,
      };
      let is_jsx = match self.source_type {
        SourceType::JSX => true,
        SourceType::TSX => true,
        _ => false,
      };
      let (aleph_jsx_fold, aleph_jsx_builtin_resolve_fold) = aleph_jsx_fold(
        resolver.clone(),
        self.source_map.clone(),
        options.is_dev && !specifier_is_remote,
      );
      let root_mark = Mark::fresh(Mark::root());
      let mut passes = chain!(
        aleph_resolve_fold(resolver.clone()),
        Optional::new(aleph_jsx_fold, is_jsx),
        Optional::new(aleph_jsx_builtin_resolve_fold, is_jsx),
        Optional::new(
          fast_refresh_fold(
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
        Optional::new(es2020(), options.target < JscTarget::Es2020),
        Optional::new(strip(), is_ts),
        Optional::new(es2018(), options.target < JscTarget::Es2018),
        Optional::new(es2017(), options.target < JscTarget::Es2017),
        Optional::new(es2016(), options.target < JscTarget::Es2016),
        Optional::new(
          es2015(root_mark, Default::default()),
          options.target < JscTarget::Es2015
        ),
        Optional::new(compat_fixer_fold(), options.target < JscTarget::Es2015),
        Optional::new(
          helpers::inject_helpers(),
          options.target < JscTarget::Es2020
        ),
        Optional::new(hygiene(), options.target < JscTarget::Es2020),
        fixer(Some(&self.comments)),
      );

      self.apply_transform(&mut passes, options.source_map)
    })
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
  use crate::aleph::VERSION;
  use crate::import_map::ImportHashMap;
  use crate::resolve::{DependencyDescriptor, Resolver, HASH_PLACEHOLDER};
  use sha1::{Digest, Sha1};

  fn t(specifer: &str, source: &str, bundling: bool) -> (String, Rc<RefCell<Resolver>>) {
    let module = ParsedModule::parse(specifer, source, None).expect("could not parse module");
    let resolver = Rc::new(RefCell::new(Resolver::new(
      specifer,
      ImportHashMap::default(),
      None,
      bundling,
      vec![],
    )));
    let (code, _) = module
      .transpile(resolver.clone(), &EmitOptions::default())
      .expect("could not transpile module");
    (code, resolver)
  }

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
    let (code, _) = t("https://deno.land/x/mod.ts", source, false);
    assert!(code.contains("var D;\n(function(D) {\n"));
    assert!(code.contains("_applyDecoratedDescriptor("));
  }

  #[test]
  fn test_transpile_jsx() {
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
    let (code, _) = t("/pages/index.tsx", source, false);
    assert!(code.contains("React.createElement(React.Fragment, null"));
    assert!(code.contains("React.createElement(\"h1\", {"));
    assert!(code.contains("className: \"title\""));
    assert!(code.contains("import React from \"../-/esm.sh/react.js\""));
  }

  #[test]
  fn test_transpile_use_deno() {
    let specifer = "/pages/index.tsx";
    let source = r#"
      export default function Index() {
        const verison = useDeno(() => Deno.version)
        const verison = useDeno(async () => await readJson("data.json"))
        return (
          <>
            <p>Deno v{version.deno}</p>
            <V8 />
            <TS />
          </>
        )
      }
    "#;

    let mut hasher = Sha1::new();
    hasher.update(specifer.clone());
    hasher.update("1");
    let id_1 = base64::encode(hasher.finalize());

    let mut hasher = Sha1::new();
    hasher.update(specifer.clone());
    hasher.update("2");
    let id_2 = base64::encode(hasher.finalize());

    for _ in 0..3 {
      let (code, _) = t(specifer, source, false);
      assert!(code.contains(format!(", \"useDeno-{}\"", id_1).as_str()));
      assert!(code.contains(format!(", \"useDeno-{}\"", id_2).as_str()));
    }
  }

  #[test]
  fn test_transpile_jsx_builtin_tags() {
    let source = r#"
      import React from "https://esm.sh/react"
      export default function Index() {
        return (
          <>
            <a href="/about">About</a>
            <a href="https://github.com">About</a>
            <a href="/about" target="_blank">About</a>
            <head>
              <link rel="stylesheet" href="../style/index.css" />
            </head>
            <script src="ga.js"></script>
            <script>{`
              function gtag() {
                dataLayer.push(arguments)
              }
              window.dataLayer = window.dataLayer || [];
              gtag("js", new Date());
              gtag("config", "G-1234567890");
            `}</script>
          </>
        )
      }
    "#;
    let (code, resolver) = t("/pages/index.tsx", source, false);
    assert!(code.contains(
      format!(
        "import __ALEPH_Anchor from \"../-/deno.land/x/aleph@v{}/framework/react/anchor.js\"",
        VERSION.as_str()
      )
      .as_str()
    ));
    assert!(code.contains(
      format!(
        "import __ALEPH_Head from \"../-/deno.land/x/aleph@v{}/framework/react/head.js\"",
        VERSION.as_str()
      )
      .as_str()
    ));
    assert!(code.contains(
      format!(
        "import __ALEPH_Link from \"../-/deno.land/x/aleph@v{}/framework/react/link.js\"",
        VERSION.as_str()
      )
      .as_str()
    ));
    assert!(code.contains(
      format!(
        "import __ALEPH_Script from \"../-/deno.land/x/aleph@v{}/framework/react/script.js\"",
        VERSION.as_str()
      )
      .as_str()
    ));
    assert!(code.contains("React.createElement(\"a\","));
    assert!(code.contains("React.createElement(__ALEPH_Anchor,"));
    assert!(code.contains("React.createElement(__ALEPH_Head,"));
    assert!(code.contains("React.createElement(__ALEPH_Link,"));
    assert!(code.contains(
      format!(
        "href: \"../style/index.css.{}.js\"",
        HASH_PLACEHOLDER.as_str()
      )
      .as_str()
    ));
    assert!(code.contains("__url: \"/style/index.css\""));
    assert!(code.contains("__base: \"/pages\""));
    assert!(code.contains("React.createElement(__ALEPH_Script,"));
    let r = resolver.borrow_mut();
    assert_eq!(
      r.dep_graph,
      vec![
        DependencyDescriptor {
          specifier: "https://esm.sh/react".into(),
          is_dynamic: false,
        },
        DependencyDescriptor {
          specifier: "/style/index.css".into(),
          is_dynamic: true,
        },
        DependencyDescriptor {
          specifier: format!(
            "https://deno.land/x/aleph@v{}/framework/react/anchor.ts",
            VERSION.as_str()
          ),
          is_dynamic: false,
        },
        DependencyDescriptor {
          specifier: format!(
            "https://deno.land/x/aleph@v{}/framework/react/head.ts",
            VERSION.as_str()
          ),
          is_dynamic: false,
        },
        DependencyDescriptor {
          specifier: format!(
            "https://deno.land/x/aleph@v{}/framework/react/link.ts",
            VERSION.as_str()
          ),
          is_dynamic: false,
        },
        DependencyDescriptor {
          specifier: format!(
            "https://deno.land/x/aleph@v{}/framework/react/script.ts",
            VERSION.as_str()
          ),
          is_dynamic: false,
        }
      ]
    );
  }

  #[test]
  fn test_transpile_inlie_style() {
    let source = r#"
      export default function Index() {
        const [color, setColor] = useState('white');

        return (
          <>
            <style>{`
              :root {
                --color: ${color};
              }
            `}</style>
            <style>{`
              h1 {
                font-size: 12px;
              }
            `}</style>
          </>
        )
      }
    "#;
    let (code, resolver) = t("/pages/index.tsx", source, false);
    assert!(code.contains(
      format!(
        "import __ALEPH_Style from \"../-/deno.land/x/aleph@v{}/framework/react/style.js\"",
        VERSION.as_str()
      )
      .as_str()
    ));
    assert!(code.contains("React.createElement(__ALEPH_Style,"));
    assert!(code.contains("__styleId: \"inline-style-"));
    let r = resolver.borrow_mut();
    assert!(r.inline_styles.len() == 2);
  }

  #[test]
  fn test_transpile_bundling_import() {
    let source = r#"
      import React, { useState, useEffect as useEffect_ } from "https://esm.sh/react"
      import * as React_ from "https://esm.sh/react"
      import Logo from '../components/logo.ts'
      import Nav from '../components/nav.ts'
      import '../shared/iife.ts'
      export default function Index() {
        return (
          <>
            <head></head>
            <Logo />
            <Nav />
            <h1>Hello World</h1>
          </>
        )
      }
    "#;
    let module =
      ParsedModule::parse("/pages/index.tsx", source, None).expect("could not parse module");
    let resolver = Rc::new(RefCell::new(Resolver::new(
      "/pages/index.tsx",
      ImportHashMap::default(),
      None,
      true,
      vec!["/components/logo.ts".into(), "/shared/iife.ts".into()],
    )));
    let (code, _) = module
      .transpile(resolver.clone(), &EmitOptions::default())
      .expect("could not transpile module");
    println!("{}", code);
    assert!(code.contains("React = __ALEPH.pack[\"https://esm.sh/react\"].default"));
    assert!(code.contains("useState = __ALEPH.pack[\"https://esm.sh/react\"].useState"));
    assert!(code.contains("useEffect_ = __ALEPH.pack[\"https://esm.sh/react\"].useEffect"));
    assert!(code.contains("React_ = __ALEPH.pack[\"https://esm.sh/react\"]"));
    assert!(code.contains("Logo = __ALEPH.pack[\"/components/logo.ts\"].default"));
    assert!(!code.contains("Nav = __ALEPH.pack[\"/components/nav.ts\"].default"));
    assert!(code.contains("import Nav from \""));
    assert!(!code.contains("__ALEPH.pack[\"/shared/iife.ts\"]"));
    assert!(code.contains(
      format!(
        "__ALEPH_Head = __ALEPH.pack[\"https://deno.land/x/aleph@v{}/framework/react/head.ts\"].default",
        VERSION.as_str()
      )
      .as_str()
    ));
  }

  #[test]
  fn test_transpile_bundling_export() {
    let source = r#"
      export {default as React, useState, useEffect as useEffect_ } from "https://esm.sh/react"
      export * as React_ from "https://esm.sh/react"
      export * from "https://esm.sh/react"
    "#;
    let (code, _) = t("/pages/index.tsx", source, true);
    assert!(code.contains("__ALEPH.exportFrom(\"/pages/index.tsx\", \"https://esm.sh/react\", {"));
    assert!(
      code.contains("__ALEPH.exportFrom(\"/pages/index.tsx\", \"https://esm.sh/react\", \"*\")")
    );
    assert!(code.contains("\"default\": \"React\""));
    assert!(code.contains("\"useState\": \"useState\""));
    assert!(code.contains("\"useEffect\": \"useEffect_\""));
    assert!(code.contains("\"*\": \"React_\""));
  }
}
