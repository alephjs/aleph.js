// Copyright 2018-2020 the Deno authors. All rights reserved. MIT license.

use serde::Serialize;
use serde::Serializer;
use std::fmt;
use std::path::Path;
use std::path::PathBuf;

#[allow(non_camel_case_types)]
#[repr(i32)]
#[derive(Clone, Copy, Eq, PartialEq, Debug)]
pub enum SourceType {
  JavaScript = 0,
  JSX = 1,
  TypeScript = 2,
  TSX = 3,
  Json = 4,
  Wasm = 5,
  Unknown = 9,
}

impl fmt::Display for SourceType {
  fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
    let value = match self {
      SourceType::JavaScript => "JavaScript",
      SourceType::JSX => "JSX",
      SourceType::TypeScript => "TypeScript",
      SourceType::TSX => "TSX",
      SourceType::Json => "Json",
      SourceType::Wasm => "Wasm",
      SourceType::Unknown => "Unknown",
    };
    write!(f, "{}", value)
  }
}

impl<'a> From<&'a Path> for SourceType {
  fn from(path: &'a Path) -> Self {
    SourceType::from_path(path)
  }
}

impl<'a> From<&'a PathBuf> for SourceType {
  fn from(path: &'a PathBuf) -> Self {
    SourceType::from_path(path)
  }
}

impl<'a> From<&'a String> for SourceType {
  fn from(specifier: &'a String) -> Self {
    SourceType::from_path(&PathBuf::from(specifier))
  }
}

impl Default for SourceType {
  fn default() -> Self {
    SourceType::Unknown
  }
}

impl SourceType {
  fn from_path(path: &Path) -> Self {
    match path.extension() {
      None => SourceType::Unknown,
      Some(os_str) => match os_str.to_str() {
        Some("ts") => match path.file_stem() {
          Some(os_str) => match os_str.to_str() {
            Some(file_name) => {
              SourceType::TypeScript
            }
            None => SourceType::TypeScript,
          },
          None => SourceType::TypeScript,
        },
        Some("tsx") => SourceType::TSX,
        Some("js") => SourceType::JavaScript,
        Some("jsx") => SourceType::JSX,
        Some("mjs") => SourceType::JavaScript,
        Some("cjs") => SourceType::JavaScript,
        Some("json") => SourceType::Json,
        Some("wasm") => SourceType::Wasm ,
        _ => SourceType::Unknown,
      },
    }
  }
}

impl Serialize for SourceType {
  fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
  where
    S: Serializer,
  {
    let value = match self {
      SourceType::JavaScript => 0 as i32,
      SourceType::JSX => 1 as i32,
      SourceType::TypeScript => 2 as i32,
      SourceType::TSX => 4 as i32,
      SourceType::Json => 5 as i32,
      SourceType::Wasm => 6 as i32,
      SourceType::Unknown => 9 as i32,
    };
    Serialize::serialize(&value, serializer)
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_map_file_extension() {
    assert_eq!(
      SourceType::from(Path::new("foo/bar.ts")),
      SourceType::TypeScript
    );
    assert_eq!(SourceType::from(Path::new("foo/bar.tsx")), SourceType::TSX);
    assert_eq!(
      SourceType::from(Path::new("foo/bar.js")),
      SourceType::JavaScript
    );
    assert_eq!(SourceType::from(Path::new("foo/bar.jsx")), SourceType::JSX);
    assert_eq!(SourceType::from(Path::new("foo/bar.json")), SourceType::Json);
    assert_eq!(SourceType::from(Path::new("foo/bar.wasm")), SourceType::Wasm);
    assert_eq!(
      SourceType::from(Path::new("foo/bar.cjs")),
      SourceType::JavaScript
    );
    assert_eq!(
      SourceType::from(Path::new("foo/bar.txt")),
      SourceType::Unknown
    );
    assert_eq!(SourceType::from(Path::new("foo/bar")), SourceType::Unknown);
  }

  #[test]
  fn test_display() {
    assert_eq!(format!("{}", SourceType::JavaScript), "JavaScript");
    assert_eq!(format!("{}", SourceType::JSX), "JSX");
    assert_eq!(format!("{}", SourceType::TypeScript), "TypeScript");
    assert_eq!(format!("{}", SourceType::TSX), "TSX");
    assert_eq!(format!("{}", SourceType::Json), "Json");
    assert_eq!(format!("{}", SourceType::Wasm), "Wasm");
    assert_eq!(format!("{}", SourceType::Unknown), "Unknown");
  }
}
