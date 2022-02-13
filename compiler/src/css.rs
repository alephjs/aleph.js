/*
  parcel css - A CSS parser, transformer, and minifier written in Rust. - https://parcel-css.vercel.app
  MPL-2.0 License
*/
use parcel_css::css_modules::CssModuleExports;
use parcel_css::dependencies::Dependency;
use parcel_css::error::{MinifyError, ParserError, PrinterError};
use parcel_css::stylesheet::{MinifyOptions, ParserOptions, PrinterOptions, PseudoClasses, StyleSheet};
use parcel_css::targets::Browsers;
use parcel_sourcemap::SourceMapError;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use wasm_bindgen::JsValue;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
  pub targets: Option<Browsers>,
  pub minify: Option<bool>,
  pub source_map: Option<bool>,
  pub drafts: Option<Drafts>,
  pub css_modules: Option<bool>,
  pub analyze_dependencies: Option<bool>,
  pub pseudo_classes: Option<OwnedPseudoClasses>,
  pub unused_symbols: Option<HashSet<String>>,
}

#[derive(Serialize, Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Drafts {
  #[serde(default)]
  nesting: bool,
  #[serde(default)]
  custom_media: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OwnedPseudoClasses {
  pub hover: Option<String>,
  pub active: Option<String>,
  pub focus: Option<String>,
  pub focus_visible: Option<String>,
  pub focus_within: Option<String>,
}

impl<'a> Into<PseudoClasses<'a>> for &'a OwnedPseudoClasses {
  fn into(self) -> PseudoClasses<'a> {
    PseudoClasses {
      hover: self.hover.as_deref(),
      active: self.active.as_deref(),
      focus: self.focus.as_deref(),
      focus_visible: self.focus_visible.as_deref(),
      focus_within: self.focus_within.as_deref(),
    }
  }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransformResult {
  code: String,
  map: Option<String>,
  exports: Option<CssModuleExports>,
  dependencies: Option<Vec<Dependency>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SourceMapJson<'a> {
  version: u8,
  mappings: String,
  sources: &'a Vec<String>,
  sources_content: &'a Vec<String>,
  names: &'a Vec<String>,
}

pub fn compile<'i>(filename: String, code: &'i str, config: &Config) -> Result<TransformResult, CompileError<'i>> {
  let drafts = config.drafts.as_ref();
  let mut stylesheet = StyleSheet::parse(
    filename.clone(),
    &code,
    ParserOptions {
      nesting: matches!(drafts, Some(d) if d.nesting),
      custom_media: matches!(drafts, Some(d) if d.custom_media),
      css_modules: config.css_modules.unwrap_or(false),
    },
  )?;
  stylesheet.minify(MinifyOptions {
    targets: config.targets,
    unused_symbols: config.unused_symbols.clone().unwrap_or_default(),
  })?;
  let res = stylesheet.to_css(PrinterOptions {
    minify: config.minify.unwrap_or(false),
    source_map: config.source_map.unwrap_or(false),
    targets: config.targets,
    analyze_dependencies: config.analyze_dependencies.unwrap_or(false),
    pseudo_classes: config.pseudo_classes.as_ref().map(|p| p.into()),
  })?;

  let map = if let Some(mut source_map) = res.source_map {
    source_map.set_source_content(0, code)?;
    let mut vlq_output: Vec<u8> = Vec::new();
    source_map.write_vlq(&mut vlq_output)?;
    let sm = SourceMapJson {
      version: 3,
      mappings: unsafe { String::from_utf8_unchecked(vlq_output) },
      sources: source_map.get_sources(),
      sources_content: source_map.get_sources_content(),
      names: source_map.get_names(),
    };
    serde_json::to_string(&sm).ok()
  } else {
    None
  };

  Ok(TransformResult {
    code: res.code,
    map,
    exports: res.exports,
    dependencies: res.dependencies,
  })
}

pub enum CompileError<'i> {
  ParseError(cssparser::ParseError<'i, ParserError<'i>>),
  MinifyError(MinifyError),
  PrinterError(PrinterError),
  SourceMapError(SourceMapError),
}

impl<'i> CompileError<'i> {
  fn reason(&self) -> String {
    match self {
      CompileError::ParseError(e) => match &e.kind {
        cssparser::ParseErrorKind::Basic(b) => {
          use cssparser::BasicParseErrorKind::*;
          match b {
            AtRuleBodyInvalid => "Invalid at rule body".into(),
            EndOfInput => "Unexpected end of input".into(),
            AtRuleInvalid(name) => format!("Unknown at rule: @{}", name),
            QualifiedRuleInvalid => "Invalid qualified rule".into(),
            UnexpectedToken(token) => format!("Unexpected token {:?}", token),
          }
        }
        cssparser::ParseErrorKind::Custom(e) => e.reason(),
      },
      CompileError::MinifyError(err) => err.reason(),
      CompileError::PrinterError(err) => err.reason(),
      _ => "Unknown error".into(),
    }
  }
}

impl<'i> From<cssparser::ParseError<'i, ParserError<'i>>> for CompileError<'i> {
  fn from(e: cssparser::ParseError<'i, ParserError<'i>>) -> CompileError<'i> {
    CompileError::ParseError(e)
  }
}

impl<'i> From<MinifyError> for CompileError<'i> {
  fn from(err: MinifyError) -> CompileError<'i> {
    CompileError::MinifyError(err)
  }
}

impl<'i> From<PrinterError> for CompileError<'i> {
  fn from(err: PrinterError) -> CompileError<'i> {
    CompileError::PrinterError(err)
  }
}

impl<'i> From<SourceMapError> for CompileError<'i> {
  fn from(e: SourceMapError) -> CompileError<'i> {
    CompileError::SourceMapError(e)
  }
}

impl<'i> From<CompileError<'i>> for JsValue {
  fn from(e: CompileError) -> JsValue {
    match e {
      CompileError::SourceMapError(e) => js_sys::Error::new(&e.to_string()).into(),
      _ => js_sys::Error::new(&e.reason()).into(),
    }
  }
}
