// Copyright 2020 the Aleph.js authors. All rights reserved. MIT license.

// @ref https://github.com/facebook/react/blob/master/packages/react-refresh/src/ReactFreshBabelPlugin.js

use swc_ecma_ast::*;
use swc_ecma_visit::{noop_fold_type, Fold};

pub struct FastRefresh {
  preact: bool,
}

impl Fold for FastRefresh {
  noop_fold_type!();

  fn fold_program(&mut self, mut p: Program) -> Program {
    p
  }

  // hooks
  fn fold_expr(&mut self, mut el: Expr) -> Expr {
    el
  }
}
