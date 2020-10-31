// Copyright 2018-2020 the Aleph.js authors. All rights reserved. MIT license.

use indexmap::IndexMap;
use std::path::Path;
use swc_ecma_ast::*;
use swc_ecma_visit::{noop_fold_type, Fold};

pub type SpecifierMap = IndexMap<String, String>;

pub struct Resolver {
  imports: SpecifierMap,
  has_plugins: bool,
}

impl Resolver {
  pub fn new(imports: SpecifierMap, has_plugins: bool) -> Self {
    Resolver {
      imports,
      has_plugins,
    }
  }
  pub fn resolve(self, path: &Path, importer: &Path) {}
}

impl Fold for Resolver {
  noop_fold_type!();

  fn fold_module_decl(&mut self, mut el: ModuleDecl) -> ModuleDecl {
    el
  }

  // dynamic import & useDeno
  fn fold_expr(&mut self, mut el: Expr) -> Expr {
    el
  }
}
