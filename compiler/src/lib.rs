mod error;
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
use std::{cell::RefCell, rc::Rc};
use swc::{EmitOptions, SWC};
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
    pub jsx: String,

    #[serde(default)]
    pub jsx_import_source: String,
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

#[wasm_bindgen(js_name = "transformSync")]
pub fn transform_sync(specifier: &str, code: &str, options: JsValue) -> Result<JsValue, JsValue> {
    console_error_panic_hook::set_once();

    let options: Options = options
        .into_serde()
        .map_err(|err| format!("failed to parse options: {}", err))
        .unwrap();
    let resolver = Rc::new(RefCell::new(Resolver::new(specifier, options.import_map)));
    let module = SWC::parse(specifier, code).expect("could not parse the module");
    let (code, map) = module
        .transform(
            resolver.clone(),
            &EmitOptions {
                jsx: options.jsx,
                jsx_import_source: options.jsx_import_source,
                is_dev: options.is_dev,
            },
        )
        .expect("could not transform the module");
    let r = resolver.borrow();

    Ok(JsValue::from_serde(&TransformOutput {
        code,
        deps: r.deps.clone(),
        map,
    })
    .unwrap())
}
