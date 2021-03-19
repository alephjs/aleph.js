#[macro_use]
extern crate lazy_static;

mod error;
mod fast_refresh;
mod fixer;
mod import_map;
mod jsx;
mod resolve;
mod resolve_fold;
mod source_type;
mod swc;

use import_map::ImportHashMap;
use resolve::{DependencyDescriptor, InlineStyle, Resolver};
use serde::{Deserialize, Serialize};
use source_type::SourceType;
use std::collections::HashMap;
use std::{cell::RefCell, rc::Rc};
use swc::{EmitOptions, ParsedModule};
use swc_ecmascript::parser::JscTarget;
use wasm_bindgen::prelude::{wasm_bindgen, JsValue};

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Options {
  #[serde(default)]
  pub import_map: ImportHashMap,

  #[serde(default)]
  pub aleph_pkg_uri: String,

  #[serde(default)]
  pub react_version: String,

  #[serde(default)]
  pub swc_options: SWCOptions,

  #[serde(default)]
  pub source_map: bool,

  #[serde(default)]
  pub is_dev: bool,

  #[serde(default)]
  pub transpile_only: bool,

  #[serde(default)]
  pub bundle_mode: bool,

  #[serde(default)]
  pub bundle_external: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SWCOptions {
  #[serde(default)]
  pub source_type: String,

  #[serde(default = "default_target")]
  pub target: JscTarget,

  #[serde(default = "default_pragma")]
  pub jsx_factory: String,

  #[serde(default = "default_pragma_frag")]
  pub jsx_fragment_factory: String,
}

impl Default for SWCOptions {
  fn default() -> Self {
    SWCOptions {
      source_type: "tsx".into(),
      target: default_target(),
      jsx_factory: default_pragma(),
      jsx_fragment_factory: default_pragma_frag(),
    }
  }
}

fn default_target() -> JscTarget {
  JscTarget::Es2020
}

fn default_pragma() -> String {
  "React.createElement".into()
}

fn default_pragma_frag() -> String {
  "React.Fragment".into()
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransformOutput {
  pub code: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub map: Option<String>,
  pub deps: Vec<DependencyDescriptor>,
  pub inline_styles: HashMap<String, InlineStyle>,
  pub star_exports: Vec<String>,
}

#[wasm_bindgen(js_name = "transformSync")]
pub fn transform_sync(url: &str, code: &str, options: JsValue) -> Result<JsValue, JsValue> {
  console_error_panic_hook::set_once();

  let options: Options = options
    .into_serde()
    .map_err(|err| format!("failed to parse options: {}", err))
    .unwrap();
  let resolver = Rc::new(RefCell::new(Resolver::new(
    url,
    options.import_map,
    match options.aleph_pkg_uri.as_str() {
      "" => None,
      _ => Some(options.aleph_pkg_uri),
    },
    match options.react_version.as_str() {
      "" => None,
      _ => Some(options.react_version),
    },
    options.bundle_mode,
    options.bundle_external,
  )));
  let specify_source_type = match options.swc_options.source_type.as_str() {
    "js" => Some(SourceType::JavaScript),
    "jsx" => Some(SourceType::JSX),
    "ts" => Some(SourceType::TypeScript),
    "tsx" => Some(SourceType::TSX),
    _ => None,
  };
  let module = ParsedModule::parse(url, code, specify_source_type).expect("could not parse module");
  let (code, map) = module
    .transform(
      resolver.clone(),
      &EmitOptions {
        target: options.swc_options.target,
        jsx_factory: options.swc_options.jsx_factory.clone(),
        jsx_fragment_factory: options.swc_options.jsx_fragment_factory.clone(),
        source_map: options.source_map,
        is_dev: options.is_dev,
        transpile_only: options.transpile_only,
      },
    )
    .expect("could not transform module");
  let r = resolver.borrow_mut();
  Ok(
    JsValue::from_serde(&TransformOutput {
      code,
      map,
      deps: r.dep_graph.clone(),
      inline_styles: r.inline_styles.clone(),
      star_exports: r.star_exports.clone(),
    })
    .unwrap(),
  )
}
