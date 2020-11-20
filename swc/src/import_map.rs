// Copyright 2020 the Aleph.js authors. All rights reserved. MIT license.

use indexmap::IndexMap;
use serde::Deserialize;
use std::collections::HashMap;

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ImportHashMap {
    #[serde(default)]
    pub imports: HashMap<String, String>,
    #[serde(default)]
    pub scopes: HashMap<String, HashMap<String, String>>,
}

impl Default for ImportHashMap {
    fn default() -> Self {
        ImportHashMap {
            imports: HashMap::new(),
            scopes: HashMap::new(),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ImportMap {
    pub imports: IndexMap<String, String>,
    pub scopes: IndexMap<String, IndexMap<String, String>>,
}

impl ImportMap {
    pub fn from_hashmap(map: ImportHashMap) -> Self {
        let mut imports: IndexMap<String, String> = IndexMap::new();
        let mut scopes = IndexMap::new();
        for (k, v) in map.imports.iter() {
            imports.insert(k.into(), v.into());
        }
        for (k, v) in map.scopes.iter() {
            let mut imports_: IndexMap<String, String> = IndexMap::new();
            for (k_, v_) in v.iter() {
                imports_.insert(k_.into(), v_.into());
            }
            scopes.insert(k.into(), imports_);
        }
        ImportMap { imports, scopes }
    }

    pub fn resolve(&self, specifier: &str, url: &str) -> String {
        for (prefix, scope_imports) in self.scopes.iter() {
            if prefix.ends_with("/") && specifier.starts_with(prefix) {
                match scope_imports.get(url) {
                    Some(url) => return url.into(),
                    _ => {}
                };
                for (k, v) in scope_imports.iter() {
                    if k.ends_with("/") && url.starts_with(k) {
                        let mut alias = v.to_owned();
                        alias.push_str(url[k.len()..].into());
                        return alias.into();
                    }
                }
            }
        }
        match self.imports.get(url) {
            Some(url) => return url.into(),
            _ => {}
        };
        for (k, v) in self.imports.iter() {
            if k.ends_with("/") && url.starts_with(k) {
                let mut alias = v.to_owned();
                alias.push_str(url[k.len()..].into());
                return alias.into();
            }
        }
        url.into()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_import_maps() {
        let mut imports: HashMap<String, String> = HashMap::new();
        imports.insert("react".into(), "https://esm.sh/react".into());
        imports.insert("react-dom/".into(), "https://esm.sh/react-dom/".into());
        let mut scope_imports: HashMap<String, String> = HashMap::new();
        scope_imports.insert("react".into(), "https://esm.sh/react@16.4.0".into());
        let mut scopes: HashMap<String, HashMap<String, String>> = HashMap::new();
        scopes.insert("/scope/".into(), scope_imports);
        let import_map = ImportMap::from_hashmap(ImportHashMap {
            imports,
            scopes,
        });
        assert_eq!(import_map.resolve(".", "react"), "https://esm.sh/react");
        assert_eq!(import_map.resolve(".", "react-dom/server"), "https://esm.sh/react-dom/server");
        assert_eq!(import_map.resolve("/scope/react-dom", "react"), "https://esm.sh/react@16.4.0");
    }
}
