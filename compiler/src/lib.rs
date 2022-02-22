#[macro_use]
extern crate lazy_static;

mod css;
mod error;
mod expr_utils;
mod hmr;
mod import_map;
mod resolve_fold;
mod resolver;
mod source_type;
mod swc;

#[cfg(test)]
mod tests;

use import_map::ImportHashMap;
use resolver::{DependencyDescriptor, Resolver};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::{cell::RefCell, rc::Rc};
use swc::{EmitOptions, SWC};
use swc_ecma_ast::EsVersion;
use wasm_bindgen::prelude::{wasm_bindgen, JsValue};

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Options {
  #[serde(default)]
  pub aleph_pkg_uri: String,

  #[serde(default)]
  pub is_dev: bool,

  #[serde(default)]
  pub import_map: ImportHashMap,

  #[serde(default)]
  pub graph_versions: HashMap<String, String>,

  #[serde(default)]
  pub initial_graph_version: Option<String>,

  #[serde(default = "default_target")]
  pub target: String,

  pub jsx_runtime: Option<String>,

  #[serde(default)]
  pub jsx_runtime_version: Option<String>,

  #[serde(default)]
  pub jsx_runtime_cdn_version: Option<String>,

  #[serde(default)]
  pub jsx_import_source: Option<String>,

  #[serde(default)]
  pub strip_data_export: bool,
}

fn default_target() -> String {
  return "es2022".into();
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransformOutput {
  pub code: String,

  #[serde(skip_serializing_if = "Vec::is_empty")]
  pub deps: Vec<DependencyDescriptor>,

  #[serde(skip_serializing_if = "Option::is_none")]
  pub map: Option<String>,
}

#[wasm_bindgen(js_name = "fastTransform")]
pub fn fast_transform(specifier: &str, code: &str, options: JsValue) -> Result<JsValue, JsValue> {
  console_error_panic_hook::set_once();

  let options: Options = options
    .into_serde()
    .map_err(|err| format!("failed to parse options: {}", err))
    .unwrap();
  let resolver = Rc::new(RefCell::new(Resolver::new(
    specifier,
    "",
    None,
    None,
    None,
    options.import_map,
    options.graph_versions,
    options.initial_graph_version,
    false,
    false,
  )));
  let module = SWC::parse(specifier, code, EsVersion::Es2022).expect("could not parse the module");
  let (code, map) = module
    .fast_transform(resolver.clone())
    .expect("could not transform the module");
  let r = resolver.borrow();

  Ok(
    JsValue::from_serde(&TransformOutput {
      code,
      deps: r.deps.clone(),
      map,
    })
    .unwrap(),
  )
}

#[wasm_bindgen(js_name = "transform")]
pub fn transform(specifier: &str, code: &str, options: JsValue) -> Result<JsValue, JsValue> {
  console_error_panic_hook::set_once();

  let options: Options = options
    .into_serde()
    .map_err(|err| format!("failed to parse options: {}", err))
    .unwrap();
  let resolver = Rc::new(RefCell::new(Resolver::new(
    specifier,
    &options.aleph_pkg_uri,
    options.jsx_runtime,
    options.jsx_runtime_version,
    options.jsx_runtime_cdn_version,
    options.import_map,
    options.graph_versions,
    options.initial_graph_version,
    options.is_dev,
    true,
  )));
  let target = match options.target.as_str() {
    "es2015" => EsVersion::Es2015,
    "es2016" => EsVersion::Es2016,
    "es2017" => EsVersion::Es2017,
    "es2018" => EsVersion::Es2018,
    "es2019" => EsVersion::Es2019,
    "es2020" => EsVersion::Es2020,
    "es2021" => EsVersion::Es2021,
    "es2022" => EsVersion::Es2022,
    _ => EsVersion::Es2015, // minium version
  };
  let module = SWC::parse(specifier, code, target).expect("could not parse the module");
  let (code, map) = module
    .transform(
      resolver.clone(),
      &EmitOptions {
        strip_data_export: options.strip_data_export,
        jsx_import_source: options.jsx_import_source,
        minify: !options.is_dev,
        source_map: options.is_dev,
      },
    )
    .expect("could not transform the module");
  let r = resolver.borrow();

  Ok(
    JsValue::from_serde(&TransformOutput {
      code,
      deps: r.deps.clone(),
      map,
    })
    .unwrap(),
  )
}

#[wasm_bindgen(js_name = "transformCSS")]
pub fn transform_css(filename: &str, code: &str, config_val: JsValue) -> Result<JsValue, JsValue> {
  let config: css::Config = config_val
    .into_serde()
    .map_err(|err| format!("failed to parse options: {}", err))
    .unwrap();
  let res = css::compile(filename.into(), code, &config)?;
  Ok(JsValue::from_serde(&res).unwrap())
}
