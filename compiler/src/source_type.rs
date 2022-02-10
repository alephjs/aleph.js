use serde::Deserialize;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
pub enum SourceType {
  #[serde(rename = "js")]
  JS,
  #[serde(rename = "jsx")]
  JSX,
  #[serde(rename = "ts")]
  TS,
  #[serde(rename = "tsx")]
  TSX,
  #[serde(rename = "??")]
  Unknown,
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
        Some("mts") => SourceType::TS,
        Some("ts") => SourceType::TS,
        Some("tsx") => SourceType::TSX,
        Some("mjs") => SourceType::JS,
        Some("js") => SourceType::JS,
        Some("jsx") => SourceType::JSX,
        _ => SourceType::Unknown,
      },
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn map_file_extension() {
    assert_eq!(SourceType::from(Path::new("/foo/bar.mts")), SourceType::TS);
    assert_eq!(SourceType::from(Path::new("/foo/bar.ts")), SourceType::TS);
    assert_eq!(SourceType::from(Path::new("/foo/bar.tsx")), SourceType::TSX);
    assert_eq!(SourceType::from(Path::new("/foo/bar.js")), SourceType::JS);
    assert_eq!(SourceType::from(Path::new("/foo/bar.mjs")), SourceType::JS);
    assert_eq!(SourceType::from(Path::new("/foo/bar.jsx")), SourceType::JSX);
    assert_eq!(
      SourceType::from(Path::new("/foo/bar.txt")),
      SourceType::Unknown
    );
    assert_eq!(SourceType::from(Path::new("/foo/bar")), SourceType::Unknown);
  }
}
