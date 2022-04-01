use import_map::ImportMap;
use indexmap::IndexSet;
use path_slash::PathBufExt;
use pathdiff::diff_paths;
use regex::Regex;
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
  #[serde(skip)]
  pub import_url: String,
  #[serde(skip_serializing_if = "is_false")]
  pub dynamic: bool,
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
  pub jsx_runtime: Option<String>,
  /// jsx static class names
  pub jsx_static_classes: IndexSet<String>,
  /// development mode
  pub is_dev: bool,
  // internal
  import_map: ImportMap,
  resolve_remote_deps: bool,
  jsx_runtime_version: Option<String>,
  jsx_runtime_cdn_version: Option<String>,
  graph_versions: HashMap<String, String>,
  initial_graph_version: Option<String>,
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
    jsx_runtime: Option<String>,
    jsx_runtime_version: Option<String>,
    jsx_runtime_cdn_version: Option<String>,
    import_map: ImportMap,
    graph_versions: HashMap<String, String>,
    initial_graph_version: Option<String>,
    is_dev: bool,
    resolve_remote_deps: bool,
  ) -> Self {
    Resolver {
      aleph_pkg_uri: aleph_pkg_uri.into(),
      specifier: specifier.into(),
      specifier_is_remote: is_http_url(specifier),
      deps: Vec::new(),
      jsx_runtime,
      jsx_runtime_version,
      jsx_runtime_cdn_version,
      jsx_static_classes: IndexSet::new(),
      import_map,
      graph_versions,
      initial_graph_version,
      is_dev,
      resolve_remote_deps,
    }
  }

  /// fix remote url for dev mode.
  //  - `https://esm.sh/react` -> `/-/esm.sh/react`
  //  - `https://deno.land/std/path/mod.ts` -> `/-/deno.land/std/path/mod.ts`
  //  - `http://localhost:8080/mod.ts` -> `/-/http_localhost_8080/mod.ts`
  pub fn to_local_path(&self, url: &str) -> String {
    let url = Url::from_str(url).unwrap();
    let pathname = Path::new(url.path());
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
    if is_css_url(url.path()) {
      if let Some(query) = url.query() {
        local_path.push('?');
        local_path.push_str(query);
        local_path.push_str("&module");
      } else {
        local_path.push_str("?module");
      }
    } else if let Some(query) = url.query() {
      local_path.push('?');
      local_path.push_str(query);
    }
    local_path
  }

  /// Resolve import/export URLs.
  pub fn resolve(&mut self, url: &str, dynamic: bool) -> String {
    let referrer = if self.specifier_is_remote {
      Url::from_str(self.specifier.as_str()).unwrap()
    } else {
      Url::from_str(&("file://".to_owned() + self.specifier.trim_start_matches('.'))).unwrap()
    };
    let resolved_url = if let Ok(ret) = self.import_map.resolve(url, &referrer) {
      ret.to_string()
    } else {
      url.into()
    };
    let mut import_url = if resolved_url.starts_with("file://") {
      let path = resolved_url.strip_prefix("file://").unwrap();
      if !self.specifier_is_remote {
        let mut buf = PathBuf::from(self.specifier.trim_start_matches('.'));
        buf.pop();
        let mut path = diff_paths(&path, buf).unwrap().to_slash().unwrap().to_string();
        if !path.starts_with("./") && !path.starts_with("../") {
          path = "./".to_owned() + &path
        }
        path
      } else {
        ".".to_owned() + path
      }
    } else {
      resolved_url.clone()
    };
    let mut fixed_url: String = if resolved_url.starts_with("file://") {
      ".".to_owned() + resolved_url.strip_prefix("file://").unwrap()
    } else {
      resolved_url.into()
    };
    let is_remote = is_http_url(&fixed_url);

    // fix react/react-dom url
    if is_remote && RE_REACT_URL.is_match(fixed_url.as_str()) {
      if let Some(jsx_runtime_version) = &self.jsx_runtime_version {
        let caps = RE_REACT_URL.captures(fixed_url.as_str()).unwrap();
        let host = caps.get(1).map_or("", |m| m.as_str());
        let build_version = caps.get(2).map_or("", |m| m.as_str().strip_prefix("/v").unwrap());
        let dom = caps.get(3).map_or("", |m| m.as_str());
        let ver = caps.get(4).map_or("", |m| m.as_str());
        let path = caps.get(5).map_or("", |m| m.as_str());
        let target_build_version = if let Some(jsx_runtime_cdn_version) = &self.jsx_runtime_cdn_version {
          if build_version != "" && !build_version.eq(jsx_runtime_cdn_version) {
            Some(jsx_runtime_cdn_version.clone())
          } else {
            None
          }
        } else {
          None
        };
        if ver != jsx_runtime_version || target_build_version.is_some() {
          if let Some(target_build_version) = target_build_version {
            fixed_url = format!(
              "https://{}/v{}/react{}@{}{}",
              host, target_build_version, dom, jsx_runtime_version, path
            );
          } else if build_version != "" {
            fixed_url = format!(
              "https://{}/v{}/react{}@{}{}",
              host, build_version, dom, jsx_runtime_version, path
            );
          } else {
            fixed_url = format!("https://{}/react{}@{}{}", host, dom, jsx_runtime_version, path);
          }
          import_url = fixed_url.clone();
        }
      }
    }

    if self.is_dev && is_esm_sh_url(&fixed_url) {
      if fixed_url.contains("?") {
        fixed_url = fixed_url + "&dev"
      } else {
        fixed_url = fixed_url + "?dev"
      }
      import_url = fixed_url.clone();
    }

    if is_css_url(&import_url) {
      if import_url.contains("?") {
        import_url = import_url + "&module"
      } else {
        import_url = import_url + "?module"
      }
    }

    if is_remote {
      // fix remote url to local path if allowed
      if self.resolve_remote_deps {
        import_url = self.to_local_path(&import_url);
      }
    } else {
      // apply graph version if exists
      let v = if self.graph_versions.contains_key(&fixed_url) {
        self.graph_versions.get(&fixed_url)
      } else {
        self.initial_graph_version.as_ref()
      };
      if let Some(version) = v {
        if import_url.contains("?") {
          import_url = format!("{}&v={}", import_url, version);
        } else {
          import_url = format!("{}?v={}", import_url, version);
        }
      }
    }

    // update dep graph
    self.deps.push(DependencyDescriptor {
      specifier: fixed_url.clone(),
      import_url: import_url.clone(),
      dynamic,
    });

    import_url
  }
}

pub fn is_esm_sh_url(url: &str) -> bool {
  return url.starts_with("https://esm.sh/") || url.starts_with("http://esm.sh/");
}

pub fn is_http_url(url: &str) -> bool {
  return url.starts_with("https://") || url.starts_with("http://");
}

pub fn is_css_url(url: &str) -> bool {
  if is_esm_sh_url(url) {
    let url = Url::from_str(url).unwrap();
    for (key, _value) in url.query_pairs() {
      if key.eq("css") {
        return true;
      }
    }
    return false;
  }
  return url.ends_with(".css") || url.starts_with(".pcss") || url.starts_with(".postcss");
}

fn is_false(value: &bool) -> bool {
  return !*value;
}
