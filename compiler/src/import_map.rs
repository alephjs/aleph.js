// Copyright 2020 the Aleph.js authors. All rights reserved. MIT license.

use indexmap::IndexMap;
use serde::Deserialize;
use std::collections::HashMap;

type SpecifierHashMap = HashMap<String, String>;
type SpecifierMap = IndexMap<String, String>;

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ImportHashMap {
    #[serde(default)]
    pub imports: SpecifierHashMap,
    #[serde(default)]
    pub scopes: HashMap<String, SpecifierHashMap>,
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
    pub imports: SpecifierMap,
    pub scopes: IndexMap<String, SpecifierMap>,
}

impl ImportMap {
    pub fn from_hashmap(map: ImportHashMap) -> Self {
        let mut imports: SpecifierMap = IndexMap::new();
        let mut scopes = IndexMap::new();
        for (k, v) in map.imports.iter() {
            imports.insert(k.into(), v.into());
        }
        for (k, v) in map.scopes.iter() {
            let mut map: SpecifierMap = IndexMap::new();
            for (k, v) in v.iter() {
                map.insert(k.into(), v.into());
            }
            scopes.insert(k.into(), map);
        }
        ImportMap { imports, scopes }
    }

    pub fn resolve(&self, specifier: &str, url: &str) -> String {
        for (prefix, scope_imports) in self.scopes.iter() {
            if prefix.ends_with("/") && specifier.starts_with(prefix) {
                match scope_imports.get(url) {
                    Some(alias) => {
                        return alias.to_owned();
                    }
                    _ => {}
                };
                for (k, alias) in scope_imports.iter() {
                    if k.ends_with("/") && url.starts_with(k) {
                        let mut alias = alias.to_owned();
                        alias.push_str(url[k.len()..].into());
                        return alias;
                    }
                }
            }
        }
        match self.imports.get(url) {
            Some(alias) => {
                return alias.to_owned();
            }
            _ => {}
        };
        for (k, alias) in self.imports.iter() {
            if k.ends_with("/") && url.starts_with(k) {
                let mut alias = alias.to_owned();
                alias.push_str(url[k.len()..].into());
                return alias;
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
        let mut imports: SpecifierHashMap = HashMap::new();
        let mut scopes: HashMap<String, SpecifierHashMap> = HashMap::new();
        let mut scope_imports: SpecifierHashMap = HashMap::new();
        imports.insert("react".into(), "https://esm.sh/react".into());
        imports.insert("react-dom/".into(), "https://esm.sh/react-dom/".into());
        imports.insert(
            "https://deno.land/x/aleph/".into(),
            "http://localhost:9006/".into(),
        );
        scope_imports.insert("react".into(), "https://esm.sh/react@16.4.0".into());
        scopes.insert("/scope/".into(), scope_imports);
        let import_map = ImportMap::from_hashmap(ImportHashMap { imports, scopes });
        assert_eq!(
            import_map.resolve("./app.tsx", "react"),
            "https://esm.sh/react"
        );
        assert_eq!(
            import_map.resolve("./app.tsx", "https://deno.land/x/aleph/mod.ts"),
            "http://localhost:9006/mod.ts"
        );
        assert_eq!(
            import_map.resolve("./renderer.ts", "react-dom/server"),
            "https://esm.sh/react-dom/server"
        );
        assert_eq!(
            import_map.resolve("/scope/react-dom", "react"),
            "https://esm.sh/react@16.4.0"
        );
    }
}
