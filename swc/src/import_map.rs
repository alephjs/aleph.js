// Copyright 2020 the Aleph.js authors. All rights reserved. MIT license.

use indexmap::IndexMap;
use serde::Deserialize;
use std::collections::HashMap;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ImportMap {
    pub imports: IndexMap<String, String>,
    pub scopes: IndexMap<String, IndexMap<String, String>>,
}

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
}
