// Copyright 2020 the Aleph.js authors. All rights reserved. MIT license.

#[macro_use]
extern crate lazy_static;

mod aleph;
mod error;
mod fast_refresh;
mod import_map;
mod jsx;
mod resolve;
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
    pub url: String,

    #[serde(default)]
    pub import_map: ImportHashMap,

    #[serde(default = "default_react_url")]
    pub react_url: String,

    #[serde(default = "default_react_dom_url")]
    pub react_dom_url: String,

    #[serde(default)]
    pub swc_options: SWCOptions,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SWCOptions {
    #[serde(default = "default_target")]
    pub target: JscTarget,

    #[serde(default = "default_pragma")]
    pub jsx_factory: String,

    #[serde(default = "default_pragma_frag")]
    pub jsx_fragment_factory: String,

    #[serde(default)]
    pub source_type: String,

    #[serde(default)]
    pub source_map: bool,

    #[serde(default)]
    pub is_dev: bool,

    #[serde(default)]
    pub bundle_mode: bool,
}

impl Default for SWCOptions {
    fn default() -> Self {
        SWCOptions {
            target: default_target(),
            jsx_factory: default_pragma(),
            jsx_fragment_factory: default_pragma_frag(),
            source_type: "".into(),
            source_map: false,
            is_dev: false,
            bundle_mode: false,
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

fn default_react_url() -> String {
    "https://esm.sh/react@17.0.1".into()
}

fn default_react_dom_url() -> String {
    "https://esm.sh/react-dom@17.0.1".into()
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransformOutput {
    pub code: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub map: Option<String>,
    pub deps: Vec<DependencyDescriptor>,
    pub inline_styles: HashMap<String, InlineStyle>,
}

#[wasm_bindgen(js_name = "transformSync")]
pub fn transform_sync(s: &str, opts: JsValue) -> Result<JsValue, JsValue> {
    console_error_panic_hook::set_once();

    let opts: Options = opts
        .into_serde()
        .map_err(|err| format!("failed to parse options: {}", err))
        .unwrap();
    let resolver = Rc::new(RefCell::new(Resolver::new(
        opts.url.as_str(),
        opts.import_map,
        Some((opts.react_url, opts.react_dom_url)),
        opts.swc_options.bundle_mode,
    )));
    let specify_source_type = match opts.swc_options.source_type.as_str() {
        "js" => Some(SourceType::JavaScript),
        "jsx" => Some(SourceType::JSX),
        "ts" => Some(SourceType::TypeScript),
        "tsx" => Some(SourceType::TSX),
        _ => None,
    };
    let module = ParsedModule::parse(
        opts.url.as_str(),
        s,
        specify_source_type,
        opts.swc_options.target,
    )
    .expect("could not parse module");
    let (code, map) = module
        .transpile(
            resolver.clone(),
            &EmitOptions {
                jsx_factory: opts.swc_options.jsx_factory.clone(),
                jsx_fragment_factory: opts.swc_options.jsx_fragment_factory.clone(),
                is_dev: opts.swc_options.is_dev,
                source_map: opts.swc_options.source_map,
            },
        )
        .expect("could not transpile module");
    let r = resolver.borrow_mut();
    Ok(JsValue::from_serde(&TransformOutput {
        code,
        map,
        deps: r.dep_graph.clone(),
        inline_styles: r.inline_styles.clone(),
    })
    .unwrap())
}
