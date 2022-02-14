use crate::import_map::{ImportHashMap, ImportMap};
use indexmap::IndexSet;
use path_slash::PathBufExt;
use regex::Regex;
use relative_path::RelativePath;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use url::Url;

lazy_static! {
  pub static ref RE_REACT_URL: Regex =
    Regex::new(r"^https?://(esm\.sh|cdn\.esm\.sh)(/v\d+)?/react(\-dom)?(@[^/]+)?(/.*)?$").unwrap();
  pub static ref RE_PROTOCOL_URL: Regex = Regex::new(r"^(mailto:|[a-z]+://)").unwrap();
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DependencyDescriptor {
  pub specifier: String,
  #[serde(skip_serializing_if = "is_false")]
  pub is_dynamic: bool,
  #[serde(skip_serializing_if = "is_false")]
  pub is_star_export: bool,
}

/// A Resolver to resolve esm import/export URL.
pub struct Resolver {
  /// aleph pkg uri
  pub aleph_pkg_uri: String,
  /// the text specifier associated with the import/export statement.
  pub specifier: String,
  /// a flag indicating if the specifier is a remote(http) url.
  pub specifier_is_remote: bool,
  /// a ordered dependencies of the module
  pub deps: Vec<DependencyDescriptor>,
  /// jsx runtime: react | preact
  pub jsx_runtime: String,
  /// jsx magic tags like `a`, `link`, `head`, etc...
  pub jsx_magic_tags: IndexSet<String>,
  /// jsx static class names
  pub jsx_static_class_names: IndexSet<String>,
  /// jsx inline styles
  pub jsx_inline_styles: HashMap<String, InlineStyle>,
  // internal
  jsx_runtime_version: String,
  jsx_runtime_cdn_version: String,
  import_map: ImportMap,
  graph_versions: HashMap<String, i64>,
  is_dev: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InlineStyle {
  pub r#type: String,
  pub quasis: Vec<String>,
  pub exprs: Vec<String>,
}

impl Resolver {
  pub fn new(
    specifier: &str,
    aleph_pkg_uri: &str,
    jsx_runtime: &str,
    jsx_runtime_version: &str,
    jsx_runtime_cdn_version: &str,
    import_map: ImportHashMap,
    graph_versions: HashMap<String, i64>,
    is_dev: bool,
  ) -> Self {
    Resolver {
      specifier: specifier.into(),
      specifier_is_remote: is_remote_url(specifier),
      deps: Vec::new(),
      jsx_runtime: jsx_runtime.into(),
      jsx_runtime_version: jsx_runtime_version.into(),
      jsx_runtime_cdn_version: jsx_runtime_cdn_version.into(),
      jsx_magic_tags: IndexSet::new(),
      jsx_inline_styles: HashMap::new(),
      jsx_static_class_names: IndexSet::new(),
      aleph_pkg_uri: aleph_pkg_uri.into(),
      import_map: ImportMap::from_hashmap(import_map),
      graph_versions,
      is_dev,
    }
  }

  /// fix remote url.
  //  - `https://esm.sh/react` -> `https://esm.sh/react`
  //  - `https://deno.land/std/path/mod.ts` -> `/-/deno.land/std/path/mod.ts`
  //  - `http://localhost:8080/mod.ts` -> `/-/http_localhost_8080/mod.ts`
  pub fn fix_remote_url(&self, url: &str) -> String {
    let url = Url::from_str(url).unwrap();
    let pathname = Path::new(url.path());
    let mut nonjs = false;
    if let Some(os_str) = pathname.extension() {
      if let Some(s) = os_str.to_str() {
        match s {
          "ts" | "jsx" | "mts" | "tsx" => {
            nonjs = true;
          }
          _ => {}
        }
      }
    };
    if !nonjs {
      return url.into();
    }

    let mut local_path = "/-/".to_owned();
    let scheme = url.scheme();
    if scheme == "http" {
      local_path.push_str("http_");
    }
    local_path.push_str(url.host_str().unwrap());
    if let Some(port) = url.port() {
      if scheme == "http" && port == 80 {
      } else if scheme == "https" && port == 443 {
      } else {
        local_path.push('_');
        local_path.push_str(port.to_string().as_str());
      }
    }
    local_path.push_str(pathname.to_owned().to_slash().unwrap().as_str());
    if url.path().ends_with(".css") {
      if url.query().is_some() {
        local_path.push_str(url.query().unwrap());
        local_path.push_str("&module");
      } else {
        local_path.push_str("?module");
      }
    } else if url.query().is_some() {
      local_path.push_str(url.query().unwrap());
    }
    local_path
  }

  /// Resolve import/export URLs.
  pub fn resolve(&mut self, url: &str, is_dynamic: bool, is_star_export: bool) -> String {
    // apply import maps
    let url = self.import_map.resolve(self.specifier.as_str(), url);
    let url = url.as_str();
    let mut is_remote = is_remote_url(url);
    let mut fixed_url: String = if is_remote {
      url.into()
    } else {
      if self.specifier_is_remote {
        let mut new_url = Url::from_str(self.specifier.as_str()).unwrap();
        if url.starts_with("/") {
          new_url.set_path(url);
        } else {
          let mut buf = PathBuf::from(new_url.path());
          buf.pop();
          buf.push(url);
          let path = "/".to_owned() + RelativePath::new(buf.to_slash().unwrap().as_str()).normalize().as_str();
          new_url.set_path(path.as_str());
        }
        is_remote = true;
        new_url.as_str().into()
      } else {
        if url.starts_with("/") {
          url.into()
        } else {
          let mut buf = PathBuf::from(self.specifier.as_str());
          buf.pop();
          buf.push(url);
          let rel_path = RelativePath::new(buf.to_slash().unwrap().as_str()).normalize();
          if self.specifier.starts_with("/") {
            "/".to_owned() + rel_path.as_str()
          } else {
            "./".to_owned() + rel_path.as_str()
          }
        }
      }
    };

    // fix react/react-dom url
    if is_remote && RE_REACT_URL.is_match(fixed_url.as_str()) && !self.jsx_runtime_version.is_empty() {
      let caps = RE_REACT_URL.captures(fixed_url.as_str()).unwrap();
      let host = caps.get(1).map_or("", |m| m.as_str());
      let build_version = caps.get(2).map_or("", |m| m.as_str().strip_prefix("/v").unwrap());
      let dom = caps.get(3).map_or("", |m| m.as_str());
      let ver = caps.get(4).map_or("", |m| m.as_str());
      let path = caps.get(5).map_or("", |m| m.as_str());
      let (target_build_version, should_replace_build_version) = if !self.jsx_runtime_cdn_version.is_empty() {
        (
          self.jsx_runtime_cdn_version.clone(),
          build_version != "" && !build_version.eq(&self.jsx_runtime_cdn_version),
        )
      } else {
        ("".to_owned(), false)
      };
      if ver != self.jsx_runtime_version || should_replace_build_version {
        if should_replace_build_version {
          fixed_url = format!(
            "https://{}/v{}/react{}@{}{}",
            host, target_build_version, dom, self.jsx_runtime_version, path
          );
        } else if build_version != "" {
          fixed_url = format!(
            "https://{}/v{}/react{}@{}{}",
            host, build_version, dom, self.jsx_runtime_version, path
          );
        } else {
          fixed_url = format!("https://{}/react{}@{}{}", host, dom, self.jsx_runtime_version, path);
        }
      }
    }

    if self.is_dev && is_esm_sh_url(&fixed_url) {
      if fixed_url.contains("?") {
        fixed_url = fixed_url + "&dev"
      } else {
        fixed_url = fixed_url + "?dev"
      }
    }

    // push into dep graph
    self.deps.push(DependencyDescriptor {
      specifier: fixed_url.clone(),
      is_dynamic,
      is_star_export,
    });

    let mut import_url = if is_remote {
      fixed_url.to_owned()
    } else {
      url.to_owned()
    };
    if import_url.ends_with(".css") {
      import_url = import_url + "?module"
    }

    if is_remote {
      return self.fix_remote_url(&import_url);
    }

    if self.graph_versions.contains_key(&fixed_url) {
      let version = self.graph_versions.get(&fixed_url).unwrap();
      if import_url.contains("?") {
        import_url = format!("{}&v={}", import_url, version);
      } else {
        import_url = format!("{}?v={}", import_url, version);
      }
    }

    import_url
  }
}

pub fn is_esm_sh_url(url: &str) -> bool {
  return url.starts_with("https://esm.sh") || url.starts_with("http://esm.sh");
}

pub fn is_remote_url(url: &str) -> bool {
  return url.starts_with("https://") || url.starts_with("http://");
}

fn is_false(value: &bool) -> bool {
  return !*value;
}
