use crate::import_map::{ImportHashMap, ImportMap};
use indexmap::IndexSet;
use path_slash::PathBufExt;
use regex::Regex;
use relative_path::RelativePath;
use serde::Deserialize;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use url::Url;

lazy_static! {
    pub static ref RE_REACT_URL: Regex =
        Regex::new(r"^https?://(esm\.sh|cdn\.esm\.sh)(/v\d+)?/react(\-dom)?(@[^/]+)?(/.*)?$")
            .unwrap();
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DependencyDescriptor {
    pub specifier: String,
    pub is_dynamic: bool,
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
    /// jsx library: react | preact
    pub jsx_runtime: String,
    /// jsx magic tags like `a`, `link`, `head`, etc...
    pub jsx_magic_tags: IndexSet<String>,
    /// jsx static class names
    pub jsx_static_class_names: IndexSet<String>,
    /// jsx inline styles
    pub jsx_inline_styles: HashMap<String, InlineStyle>,
    // internal
    import_map: ImportMap,
    versions: Versions,
    is_dev: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InlineStyle {
    pub r#type: String,
    pub quasis: Vec<String>,
    pub exprs: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Versions {
    #[serde(default)]
    pub esm_sh: String,
    #[serde(default)]
    pub react: Option<String>,
}

impl Default for Versions {
    fn default() -> Self {
        Versions {
            esm_sh: "v66".into(),
            react: None,
        }
    }
}

impl Resolver {
    pub fn new(
        specifier: &str,
        aleph_pkg_uri: &str,
        jsx_runtime: &str,
        import_map: ImportHashMap,
        versions: Versions,
        is_dev: bool,
    ) -> Self {
        Resolver {
            specifier: specifier.into(),
            specifier_is_remote: is_remote_url(specifier),
            deps: Vec::new(),
            jsx_runtime: jsx_runtime.into(),
            jsx_magic_tags: IndexSet::new(),
            jsx_inline_styles: HashMap::new(),
            jsx_static_class_names: IndexSet::new(),
            aleph_pkg_uri: aleph_pkg_uri.into(),
            import_map: ImportMap::from_hashmap(import_map),
            versions,
            is_dev,
        }
    }

    /// fix import/export url.
    //  - `https://esm.sh/react` -> `https://esm.sh/react`
    //  - `http://localhost:8080/mod.ts` -> `/-/http_localhost_8080/mod.ts`
    //  - `http://localhost:8080/style.css` -> `/-/http_localhost_8080/style.css?module`
    //  - `./style/app.css` -> `./style/app.css?module`
    pub fn fix_import_url(&self, url: &str) -> String {
        let is_remote = is_remote_url(url);
        if !is_remote {
            if url.ends_with(".css") {
                return format!("{}?module", url);
            }
            return url.into();
        }
        let url = Url::from_str(url).unwrap();
        let pathname = Path::new(url.path());
        let mut unsupported = false;
        if let Some(os_str) = pathname.extension() {
            if let Some(s) = os_str.to_str() {
                match s {
                    "ts" | "jsx" | "mts" | "tsx" => {
                        unsupported = true;
                    }
                    _ => {}
                }
            }
        };
        if !unsupported {
            return url.into();
        }

        let mut fixed_url = "/-/".to_owned();
        let scheme = url.scheme();
        if scheme == "http" {
            fixed_url.push_str("http_");
        }
        fixed_url.push_str(url.host_str().unwrap());
        if let Some(port) = url.port() {
            if scheme == "http" && port == 80 {
            } else if scheme == "https" && port == 443 {
            } else {
                fixed_url.push('_');
                fixed_url.push_str(port.to_string().as_str());
            }
        }
        fixed_url.push_str(pathname.to_owned().to_slash().unwrap().as_str());
        if url.path().ends_with(".css") {
            if url.query().is_some() {
                fixed_url.push_str(url.query().unwrap());
                fixed_url.push_str("&module");
            } else {
                fixed_url.push_str("?module");
            }
        } else if url.query().is_some() {
            fixed_url.push_str(url.query().unwrap());
        }
        fixed_url
    }

    /// Resolve import/export URLs.
    pub fn resolve(&mut self, url: &str, is_dynamic: bool, is_star_export: bool) -> String {
        // apply import maps
        let url = self.import_map.resolve(self.specifier.as_str(), url);
        let mut fixed_url: String = if is_remote_url(url.as_str()) {
            url.into()
        } else {
            if self.specifier_is_remote {
                let mut new_url = Url::from_str(self.specifier.as_str()).unwrap();
                if url.starts_with("/") {
                    new_url.set_path(url.as_str());
                } else {
                    let mut buf = PathBuf::from(new_url.path());
                    buf.pop();
                    buf.push(url);
                    let path = "/".to_owned()
                        + RelativePath::new(buf.to_slash().unwrap().as_str())
                            .normalize()
                            .as_str();
                    new_url.set_path(path.as_str());
                }
                new_url.as_str().into()
            } else {
                if url.starts_with("/") {
                    url.into()
                } else {
                    let mut buf = PathBuf::from(self.specifier.as_str());
                    buf.pop();
                    buf.push(url);
                    "/".to_owned()
                        + RelativePath::new(buf.to_slash().unwrap().as_str())
                            .normalize()
                            .as_str()
                }
            }
        };

        // fix react/react-dom url
        if let Some(react_version) = &self.versions.react {
            if RE_REACT_URL.is_match(fixed_url.as_str()) {
                let caps = RE_REACT_URL.captures(fixed_url.as_str()).unwrap();
                let host = caps.get(1).map_or("", |m| m.as_str());
                let build_version = caps
                    .get(2)
                    .map_or("", |m| m.as_str().strip_prefix("/v").unwrap());
                let dom = caps.get(3).map_or("", |m| m.as_str());
                let ver = caps.get(4).map_or("", |m| m.as_str());
                let path = caps.get(5).map_or("", |m| m.as_str());
                let (target_build_version, should_replace_build_version) = if build_version != ""
                    && !self.versions.esm_sh.is_empty()
                    && !build_version.eq(self.versions.esm_sh.as_str())
                {
                    (self.versions.esm_sh.to_string(), true)
                } else {
                    ("".to_owned(), false)
                };
                if ver != react_version || should_replace_build_version {
                    if should_replace_build_version {
                        fixed_url = format!(
                            "https://{}/v{}/react{}@{}{}",
                            host, target_build_version, dom, react_version, path
                        );
                    } else if build_version != "" {
                        fixed_url = format!(
                            "https://{}/v{}/react{}@{}{}",
                            host, build_version, dom, react_version, path
                        );
                    } else {
                        fixed_url =
                            format!("https://{}/react{}@{}{}", host, dom, react_version, path);
                    }
                }
            }
        }

        if self.is_dev && is_esm_sh(&fixed_url) {
            if fixed_url.contains("?") {
                fixed_url = fixed_url + "&dev"
            } else {
                fixed_url = fixed_url + "?dev"
            }
        }

        if fixed_url.ends_with(".css") {
            fixed_url = fixed_url + "?module"
        }

        // push to dep graph
        self.deps.push(DependencyDescriptor {
            specifier: fixed_url.clone(),
            is_dynamic,
            is_star_export,
        });

        self.fix_import_url(fixed_url.as_str())
    }
}

pub fn is_esm_sh(url: &str) -> bool {
    return url.starts_with("https://esm.sh") || url.starts_with("http://esm.sh");
}

pub fn is_remote_url(url: &str) -> bool {
    return url.starts_with("https://") || url.starts_with("http://");
}
