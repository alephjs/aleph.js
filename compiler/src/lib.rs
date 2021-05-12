#[macro_use]
extern crate lazy_static;

mod error;
mod fast_refresh;
mod import_map;
mod jsx;
mod resolve;
mod resolve_fold;
mod source_type;
mod swc;

use import_map::ImportHashMap;
use resolve::{DependencyDescriptor, InlineStyle, ReactResolve, Resolver};
use serde::{Deserialize, Serialize};
use source_type::SourceType;
use std::collections::HashMap;
use std::{cell::RefCell, rc::Rc};
use swc::{EmitOptions, SWC};
use wasm_bindgen::prelude::{wasm_bindgen, JsValue};

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Options {
  #[serde(default)]
  pub import_map: ImportHashMap,

  #[serde(default)]
  pub aleph_pkg_uri: String,

  #[serde(default)]
  pub react: Option<ReactResolve>,

  #[serde(default)]
  pub swc_options: SWCOptions,

  #[serde(default)]
  pub source_map: bool,

  #[serde(default)]
  pub is_dev: bool,

  #[serde(default)]
  pub bundle_mode: bool,

  #[serde(default)]
  pub bundle_external: Vec<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SWCOptions {
  #[serde(default)]
  pub source_type: SourceType,

  #[serde(default = "default_pragma")]
  pub jsx_factory: String,

  #[serde(default = "default_pragma_frag")]
  pub jsx_fragment_factory: String,
}

impl Default for SWCOptions {
  fn default() -> Self {
    SWCOptions {
      source_type: SourceType::default(),
      jsx_factory: default_pragma(),
      jsx_fragment_factory: default_pragma_frag(),
    }
  }
}

fn default_pragma() -> String {
  "React.createElement".into()
}

fn default_pragma_frag() -> String {
  "React.Fragment".into()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransformOutput {
  pub code: String,
  pub deps: Vec<DependencyDescriptor>,
  #[serde(skip_serializing_if = "HashMap::is_empty")]
  pub inline_styles: HashMap<String, InlineStyle>,
  #[serde(skip_serializing_if = "Vec::is_empty")]
  pub use_deno_hooks: Vec<String>,
  #[serde(skip_serializing_if = "Vec::is_empty")]
  pub star_exports: Vec<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub map: Option<String>,
}

#[wasm_bindgen(js_name = "parseExportNamesSync")]
pub fn parse_export_names_sync(
  url: &str,
  code: &str,
  options: JsValue,
) -> Result<JsValue, JsValue> {
  console_error_panic_hook::set_once();

  let options: SWCOptions = options
    .into_serde()
    .map_err(|err| format!("failed to parse options: {}", err))
    .unwrap();
  let module = SWC::parse(url, code, Some(options.source_type)).expect("could not parse module");
  let export_names = module.parse_export_names().unwrap();
  Ok(JsValue::from_serde(&export_names).unwrap())
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
    options.bundle_mode,
    options.bundle_external,
    match options.aleph_pkg_uri.as_str() {
      "" => None,
      _ => Some(options.aleph_pkg_uri),
    },
    options.react,
  )));
  let module =
    SWC::parse(url, code, Some(options.swc_options.source_type)).expect("could not parse module");
  let (code, map) = module
    .transform(
      resolver.clone(),
      &EmitOptions {
        jsx_factory: options.swc_options.jsx_factory.clone(),
        jsx_fragment_factory: options.swc_options.jsx_fragment_factory.clone(),
        source_map: options.source_map,
        is_dev: options.is_dev,
      },
    )
    .expect("could not transform module");
  let r = resolver.borrow_mut();
  Ok(
    JsValue::from_serde(&TransformOutput {
      code,
      deps: r.dep_graph.clone(),
      inline_styles: r.inline_styles.clone(),
      star_exports: r.star_exports.clone(),
      use_deno_hooks: r.use_deno_hooks.clone(),
      map,
    })
    .unwrap(),
  )
}
