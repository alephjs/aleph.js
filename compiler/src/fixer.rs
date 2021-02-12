// Copyright 2020-2021 postUI Lab. All rights reserved. MIT license.

use crate::resolve::{is_call_expr_by_name, Resolver};

use std::{cell::RefCell, rc::Rc};
use swc_common::DUMMY_SP;
use swc_ecma_ast::*;
use swc_ecma_utils::quote_ident;
use swc_ecma_visit::{noop_fold_type, Fold};

pub fn jsx_link_fixer_fold(resolver: Rc<RefCell<Resolver>>) -> impl Fold {
  JSXLinkFixer { resolver }
}

pub fn compat_fixer_fold() -> impl Fold {
  CompatFixer {}
}

struct JSXLinkFixer {
  resolver: Rc<RefCell<Resolver>>,
}

impl Fold for JSXLinkFixer {
  noop_fold_type!();

  fn fold_module_items(&mut self, module_items: Vec<ModuleItem>) -> Vec<ModuleItem> {
    let mut items = Vec::<ModuleItem>::new();
    let dep_graph = self.resolver.borrow().dep_graph.clone();
    let bundled_modules = self.resolver.borrow().bundled_modules.clone();
    let mut resolver = self.resolver.borrow_mut();

    for dep in dep_graph {
      if dep.is_dynamic && !bundled_modules.contains(&dep.specifier) {
        if let Some(rel) = &dep.rel {
          let rel = rel.as_str();
          match rel {
            "stylesheet" | "style" => {
              let (url, _) = resolver.resolve(dep.specifier.as_str(), false, Some(".".into()));
              items.push(ModuleItem::ModuleDecl(ModuleDecl::Import(ImportDecl {
                span: DUMMY_SP,
                specifiers: vec![],
                src: Str {
                  span: DUMMY_SP,
                  value: url.into(),
                  has_escape: false,
                  kind: Default::default(),
                },
                type_only: false,
                asserts: None,
              })));
            }
            _ => {}
          }
        }
      }
    }

    for item in module_items {
      items.push(item)
    }

    items
  }
}

struct CompatFixer {}

impl Fold for CompatFixer {
  noop_fold_type!();

  // - `require("regenerator-runtime")` -> `__ALEPH.require("regenerator-runtime")`
  fn fold_call_expr(&mut self, call: CallExpr) -> CallExpr {
    if is_call_expr_by_name(&call, "require") {
      let ok = match call.args.first() {
        Some(ExprOrSpread { expr, .. }) => match expr.as_ref() {
          Expr::Lit(lit) => match lit {
            Lit::Str(_) => true,
            _ => false,
          },
          _ => false,
        },
        _ => false,
      };
      if ok {
        return CallExpr {
          span: DUMMY_SP,
          callee: ExprOrSuper::Expr(Box::new(Expr::Member(MemberExpr {
            span: DUMMY_SP,
            obj: ExprOrSuper::Expr(Box::new(Expr::Ident(quote_ident!("__ALEPH")))),
            prop: Box::new(Expr::Ident(quote_ident!("require"))),
            computed: false,
          }))),
          args: call.args,
          type_args: None,
        };
      }
    }
    call
  }
}
