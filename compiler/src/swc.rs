use crate::error::{DiagnosticBuffer, ErrorBuffer};
use crate::export_names::ExportParser;
use crate::hmr::hmr;
use crate::resolve_fold::resolve_fold;
use crate::resolver::{DependencyDescriptor, Resolver};

use std::{cell::RefCell, path::Path, rc::Rc};
use swc_common::comments::SingleThreadedComments;
use swc_common::errors::{Handler, HandlerFlags};
use swc_common::{chain, FileName, Globals, Mark, SourceMap};
use swc_ecma_transforms::proposals::decorators;
use swc_ecma_transforms::react;
use swc_ecma_transforms::typescript::strip;
use swc_ecma_transforms::{fixer, helpers, hygiene, pass::Optional, resolver_with_mark};
use swc_ecmascript::ast::{EsVersion, Module, Program};
use swc_ecmascript::codegen::{text_writer::JsWriter, Node};
use swc_ecmascript::parser::{lexer::Lexer, EsConfig, StringInput, Syntax, TsConfig};
use swc_ecmascript::visit::{Fold, FoldWith};

/// Options for transpiling a module.
#[derive(Debug, Clone)]
pub struct EmitOptions {
  pub jsx_import_source: Option<String>,
  pub strip_data_export: bool,
  pub minify: bool,
  pub source_map: bool,
}

impl Default for EmitOptions {
  fn default() -> Self {
    EmitOptions {
      jsx_import_source: None,
      strip_data_export: false,
      minify: false,
      source_map: false,
    }
  }
}

#[derive(Clone)]
pub struct SWC {
  pub specifier: String,
  pub module: Module,
  pub source_map: Rc<SourceMap>,
  pub comments: SingleThreadedComments,
}

impl SWC {
  /// parse source code.
  pub fn parse(specifier: &str, source: &str, target: EsVersion, lang: Option<String>) -> Result<Self, anyhow::Error> {
    let source_map = SourceMap::default();
    let source_file = source_map.new_source_file(FileName::Real(Path::new(specifier).to_path_buf()), source.into());
    let sm = &source_map;
    let error_buffer = ErrorBuffer::new(specifier);
    let syntax = get_syntax(specifier, lang);
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

    Ok(SWC {
      specifier: specifier.into(),
      module,
      source_map: Rc::new(source_map),
      comments,
    })
  }

  /// parse export names in the module.
  pub fn parse_export_names(&self) -> Result<Vec<String>, anyhow::Error> {
    let program = Program::Module(self.module.clone());
    let mut parser = ExportParser { names: vec![] };
    program.fold_with(&mut parser);
    Ok(parser.names)
  }

  /// parse deps in the module.
  pub fn parse_deps(&self, resolver: Rc<RefCell<Resolver>>) -> Result<Vec<DependencyDescriptor>, anyhow::Error> {
    let program = Program::Module(self.module.clone());
    let mut resolve_fold = resolve_fold(resolver.clone(), false, true);
    program.fold_with(&mut resolve_fold);
    let resolver = resolver.borrow();
    Ok(resolver.deps.clone())
  }

  /// transform a JS/TS/JSX/TSX file into a JS file, based on the supplied options.
  pub fn transform(
    self,
    resolver: Rc<RefCell<Resolver>>,
    options: &EmitOptions,
  ) -> Result<(String, Option<String>), anyhow::Error> {
    swc_common::GLOBALS.set(&Globals::new(), || {
      let top_level_mark = Mark::fresh(Mark::root());
      let jsx_runtime = resolver.borrow().jsx_runtime.clone();
      let specifier_is_remote = resolver.borrow().specifier_is_remote;
      let is_jsx = self.specifier.ends_with(".tsx") || self.specifier.ends_with(".jsx");
      let is_dev = resolver.borrow().is_dev;
      let react_options = if let Some(jsx_import_source) = &options.jsx_import_source {
        let mut resolver = resolver.borrow_mut();
        let runtime = if is_dev { "/jsx-dev-runtime" } else { "/jsx-runtime" };
        let import_source = resolver.resolve(&(jsx_import_source.to_owned() + runtime), false, None);
        let import_source = import_source
          .strip_suffix("?dev")
          .unwrap_or(&import_source)
          .strip_suffix(runtime)
          .unwrap()
          .into();
        react::Options {
          runtime: Some(react::Runtime::Automatic),
          import_source,
          ..Default::default()
        }
      } else {
        if let Some(jsx_runtime) = &jsx_runtime {
          match jsx_runtime.as_str() {
            "preact" => react::Options {
              pragma: "h".into(),
              pragma_frag: "Fragment".into(),
              ..Default::default()
            },
            _ => react::Options { ..Default::default() },
          }
        } else {
          react::Options { ..Default::default() }
        }
      };
      let is_react = if let Some(jsx_runtime) = &jsx_runtime {
        jsx_runtime.eq("react")
      } else {
        false
      };
      let passes = chain!(
        resolver_with_mark(top_level_mark),
        Optional::new(react::jsx_src(is_dev, self.source_map.clone()), is_jsx),
        resolve_fold(resolver.clone(), options.strip_data_export, false),
        decorators::decorators(decorators::Config {
          legacy: true,
          emit_metadata: false
        }),
        helpers::inject_helpers(),
        Optional::new(
          strip::strip_with_config(strip_config_from_emit_options(), top_level_mark),
          !is_jsx
        ),
        Optional::new(
          strip::strip_with_jsx(
            self.source_map.clone(),
            strip_config_from_emit_options(),
            &self.comments,
            top_level_mark
          ),
          is_jsx
        ),
        Optional::new(
          react::refresh(
            is_dev,
            Some(react::RefreshOptions {
              refresh_reg: "$RefreshReg$".into(),
              refresh_sig: "$RefreshSig$".into(),
              emit_full_signatures: false,
            }),
            self.source_map.clone(),
            Some(&self.comments),
          ),
          !specifier_is_remote && is_react
        ),
        Optional::new(
          react::jsx(
            self.source_map.clone(),
            Some(&self.comments),
            react::Options {
              use_builtins: true,
              development: is_dev,
              ..react_options
            },
            top_level_mark
          ),
          is_jsx
        ),
        Optional::new(hmr(resolver.clone()), is_dev && !specifier_is_remote),
        fixer(Some(&self.comments)),
        hygiene()
      );

      let (code, map) = self.emit(passes, options.source_map, options.minify).unwrap();

      // remove dead deps by tree-shaking
      if options.strip_data_export {
        let mut resolver = resolver.borrow_mut();
        let mut deps: Vec<DependencyDescriptor> = Vec::new();
        let a = code.split("\"").collect::<Vec<&str>>();
        for dep in resolver.deps.clone() {
          if a.contains(&dep.import_url.as_str()) {
            deps.push(dep);
          }
        }
        resolver.deps = deps;
      }

      Ok((code, map))
    })
  }

  /// Apply transform with the fold.
  pub fn emit<T: Fold>(
    &self,
    mut fold: T,
    source_map: bool,
    minify: bool,
  ) -> Result<(String, Option<String>), anyhow::Error> {
    let program = Program::Module(self.module.clone());
    let program = helpers::HELPERS.set(&helpers::Helpers::new(false), || program.fold_with(&mut fold));
    let mut buf = Vec::new();
    let mut src_map_buf = Vec::new();
    let src_map = if source_map { Some(&mut src_map_buf) } else { None };
    {
      let writer = Box::new(JsWriter::new(self.source_map.clone(), "\n", &mut buf, src_map));
      let mut emitter = swc_ecmascript::codegen::Emitter {
        cfg: swc_ecmascript::codegen::Config { minify },
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
    fn_bind: true,
    export_default_from: true,
    import_assertions: true,
    static_blocks: true,
    private_in_object: true,
    allow_super_outside_method: true,
    jsx,
    ..EsConfig::default()
  }
}

fn get_ts_config(tsx: bool) -> TsConfig {
  TsConfig {
    decorators: true,
    tsx,
    ..TsConfig::default()
  }
}

fn get_syntax(specifier: &str, lang: Option<String>) -> Syntax {
  let lang = if let Some(lang) = lang {
    lang
  } else {
    specifier
      .split(|c| c == '?' || c == '#')
      .next()
      .unwrap()
      .split('.')
      .last()
      .unwrap_or("js")
      .to_lowercase()
  };
  match lang.as_str() {
    "js" | "mjs" => Syntax::Es(get_es_config(false)),
    "jsx" => Syntax::Es(get_es_config(true)),
    "ts" | "mts" => Syntax::Typescript(get_ts_config(false)),
    "tsx" => Syntax::Typescript(get_ts_config(true)),
    _ => Syntax::Es(get_es_config(false)),
  }
}

fn strip_config_from_emit_options() -> strip::Config {
  strip::Config {
    import_not_used_as_values: strip::ImportsNotUsedAsValues::Remove,
    use_define_for_class_fields: true,
    no_empty_export: true,
    ..Default::default()
  }
}
