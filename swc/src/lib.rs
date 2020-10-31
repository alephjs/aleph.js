// Copyright 2018-2020 the Aleph.js authors. All rights reserved. MIT license.

mod jsx;
mod resolve;
mod source_type;
mod swc;

use serde::{Deserialize, Serialize};
use swc::parse;
use swc::EmitOptions;
use swc_ecmascript::parser::JscTarget;
use wasm_bindgen::prelude::{wasm_bindgen, JsValue};

// When the `wee_alloc` feature is enabled, use `wee_alloc` as the global
// allocator.
#[cfg(feature = "wee_alloc")]
#[global_allocator]
static ALLOC: wee_alloc::WeeAlloc = wee_alloc::WeeAlloc::INIT;

// bind `console.log`
#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console)]
    fn log(s: &str);
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Options {
    #[serde(default)]
    pub filename: String,

    #[serde(default)]
    pub config: Config,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Config {
    #[serde(default = "default_target")]
    pub target: JscTarget,

    #[serde(default = "default_pragma")]
    pub jsx_factory: String,

    #[serde(default = "default_pragma_frag")]
    pub jsx_fragment_factory: String,

    #[serde(default)]
    pub minify: bool,
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

// default config
impl Default for Config {
    fn default() -> Self {
        Config {
            target: default_target(),
            jsx_factory: default_pragma(),
            jsx_fragment_factory: default_pragma_frag(),
            minify: false,
        }
    }
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
    let module =
        parse(opts.filename.as_str(), s, opts.config.target).expect("could not parse module");
    let (code, map) = module
        .transpile(&EmitOptions {
            check_js: false,
            emit_metadata: false,
            inline_source_map: false,
            jsx_factory: opts.config.jsx_factory.clone(),
            jsx_fragment_factory: opts.config.jsx_fragment_factory.clone(),
            transform_jsx: true,
            minify: opts.config.minify,
        })
        .expect("could not strip types");

    Ok(JsValue::from_serde(&TransformOutput { code, map }).unwrap())
}
