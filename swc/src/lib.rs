mod media_type;
mod swc;

use media_type::MediaType;
use swc::EmitOptions;
use swc::parse;
use serde::{Deserialize, Serialize};

use wasm_bindgen::prelude::*;

// When the `wee_alloc` feature is enabled, use `wee_alloc` as the global
// allocator.
#[cfg(feature = "wee_alloc")]
#[global_allocator]
static ALLOC: wee_alloc::WeeAlloc = wee_alloc::WeeAlloc::INIT;

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Options {
    #[serde(default)]
    pub filename: String,

    #[serde(flatten, default)]
    pub config: Option<Config>,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Config {
    #[serde(default)]
    pub minify: Option<bool>,
}

#[derive(Debug, Serialize)]
pub struct TransformOutput {
    pub code: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub map: Option<String>,
}

#[wasm_bindgen(js_name = "transformSync")]
pub fn transform_sync(s: &str, opts: JsValue) -> Result<JsValue, JsValue> {
    console_error_panic_hook::set_once();

    let opts: Options = opts
        .into_serde()
        .map_err(|err| format!("failed to parse options: {}", err))?;

    let module = parse(opts.filename.as_str(), s, &MediaType::TypeScript)
        .expect("could not parse module");
    let (code, map) = module
        .transpile(&EmitOptions::default())
        .expect("could not strip types");

    Ok(JsValue::from_serde(&TransformOutput{code, map}).unwrap())
}
