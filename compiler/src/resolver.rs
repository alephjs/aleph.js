use crate::import_map::{ImportHashMap, ImportMap};
use path_slash::PathBufExt;
use relative_path::RelativePath;
use serde::Serialize;
use std::{path::Path, path::PathBuf, str::FromStr};
use url::Url;

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DependencyDescriptor {
    pub specifier: String,
    pub is_dynamic: bool,
    pub is_star_export: bool,
}

/// A Resolver to resolve esm import/export URL.
pub struct Resolver {
    /// the text specifier associated with the import/export statement.
    pub specifier: String,
    /// a flag indicating if the specifier is a remote(http) url.
    pub specifier_is_remote: bool,
    /// a ordered dependencies of the module
    pub deps: Vec<DependencyDescriptor>,
    // internal
    import_map: ImportMap,
}

impl Resolver {
    pub fn new(specifier: &str, import_map: ImportHashMap) -> Self {
        Resolver {
            specifier: specifier.into(),
            specifier_is_remote: is_remote_url(specifier),
            deps: Vec::new(),
            import_map: ImportMap::from_hashmap(import_map),
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

pub fn is_remote_url(url: &str) -> bool {
    return url.starts_with("https://") || url.starts_with("http://");
}
