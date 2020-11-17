// Copyright 2017-2020 The swc Project Developers. All rights reserved. MIT license.
// Copyright 2020 the Aleph.js authors. All rights reserved. MIT license.

// @ref https://github.com/facebook/react/blob/master/packages/react-refresh/src/ReactFreshBabelPlugin.js
// @ref https://github.com/vovacodes/swc/tree/feature/transform-react-fast-refresh

use swc_common::DUMMY_SP;
use swc_ecma_ast::*;
use swc_ecma_utils::{private_ident, quote_ident};
use swc_ecma_visit::{noop_fold_type, Fold};

pub struct FastRefresh {}

impl Fold for FastRefresh {
  noop_fold_type!();

  fn fold_module_items(&mut self, module_items: Vec<ModuleItem>) -> Vec<ModuleItem> {
    let mut items = Vec::<ModuleItem>::new();
    let mut registration_handles = Vec::<Ident>::new();
    let mut refresh_regs = Vec::<CallExpr>::new();

    for item in module_items {
      let persistent_id: Option<Ident> = match &item {
        // function Foo() {}
        ModuleItem::Stmt(Stmt::Decl(Decl::Fn(FnDecl { ident, .. }))) => get_persistent_id(ident),

        // export function Foo() {}
        ModuleItem::ModuleDecl(ModuleDecl::ExportDecl(ExportDecl {
          decl: Decl::Fn(FnDecl { ident, .. }),
          ..
        })) => get_persistent_id(ident),

        // export default function Foo() {}
        ModuleItem::ModuleDecl(ModuleDecl::ExportDefaultDecl(ExportDefaultDecl {
          decl:
            DefaultDecl::Fn(FnExpr {
              // We don't currently handle anonymous default exports.
              ident: Some(ident),
              ..
            }),
          ..
        })) => get_persistent_id(ident),

        // const Foo = () => {}
        // export const Foo = () => {}
        ModuleItem::Stmt(Stmt::Decl(Decl::Var(var_decl)))
        | ModuleItem::ModuleDecl(ModuleDecl::ExportDecl(ExportDecl {
          decl: Decl::Var(var_decl),
          ..
        })) => get_persistent_id_from_var_decl(var_decl),

        _ => None,
      };

      items.push(item);

      if let Some(persistent_id) = persistent_id {
        let mut registration_handle = String::from("_c");
        let registration_index = registration_handles.len() + 1; // 1-based
        if registration_index > 1 {
          registration_handle.push_str(&registration_index.to_string());
        };
        let registration_handle = private_ident!(registration_handle.as_str());

        registration_handles.push(registration_handle.clone());

        // $RefreshReg$(_c, "Hello");
        refresh_regs.push(CallExpr {
          span: DUMMY_SP,
          callee: ExprOrSuper::Expr(Box::new(Expr::Ident(quote_ident!("$RefreshReg$")))),
          args: vec![
            ExprOrSpread {
              spread: None,
              expr: Box::new(Expr::Ident(registration_handle.clone())),
            },
            ExprOrSpread {
              spread: None,
              expr: Box::new(Expr::Lit(Lit::Str(Str {
                span: DUMMY_SP,
                value: persistent_id.sym.clone(),
                has_escape: false,
              }))),
            },
          ],
          type_args: None,
        });

        items.push(ModuleItem::Stmt(Stmt::Expr(ExprStmt {
          span: DUMMY_SP,
          expr: Box::new(Expr::Assign(AssignExpr {
            span: DUMMY_SP,
            op: AssignOp::Assign,
            left: PatOrExpr::Pat(Box::new(Pat::Ident(registration_handle))),
            right: Box::new(Expr::Ident(persistent_id)),
          })),
        })));
      }
    }

    // Insert
    // ```
    // var _c, _c2;
    // ```
    if registration_handles.len() > 0 {
      items.push(ModuleItem::Stmt(Stmt::Decl(Decl::Var(VarDecl {
        span: DUMMY_SP,
        kind: VarDeclKind::Var,
        declare: false,
        decls: registration_handles
          .into_iter()
          .map(|handle| VarDeclarator {
            span: DUMMY_SP,
            name: Pat::Ident(handle),
            init: None,
            definite: false,
          })
          .collect(),
      }))));
    }

    // Insert
    // ```
    // $RefreshReg$(_c, "Hello");
    // $RefreshReg$(_c2, "Foo");
    // ```
    for refresh_reg in refresh_regs {
      items.push(ModuleItem::Stmt(Stmt::Expr(ExprStmt {
        span: DUMMY_SP,
        expr: Box::new(Expr::Call(refresh_reg)),
      })));
    }

    items
  }
}

fn is_componentish_name(name: &str) -> bool {
  name.starts_with(char::is_uppercase)
}

fn get_persistent_id(ident: &Ident) -> Option<Ident> {
  if is_componentish_name(ident.as_ref()) {
    Some(ident.clone())
  } else {
    None
  }
}

fn get_persistent_id_from_var_decl(var_decl: &VarDecl) -> Option<Ident> {
  match var_decl.decls.as_slice() {
    // We only handle the case when a single variable is declared
    [VarDeclarator {
      name: Pat::Ident(ident),
      init: Some(init_expr),
      ..
    }] => {
      if let Some(persistent_id) = get_persistent_id(ident) {
        match init_expr.as_ref() {
          Expr::Fn(_) => Some(persistent_id),
          Expr::Arrow(ArrowExpr { body, .. }) => {
            if is_body_arrow_fn(body) {
              // Ignore complex function expressions like
              // let Foo = () => () => {}
              None
            } else {
              Some(persistent_id)
            }
          }
          _ => None,
        }
      } else {
        None
      }
    }
    _ => None,
  }
}

fn is_body_arrow_fn(body: &BlockStmtOrExpr) -> bool {
  if let BlockStmtOrExpr::Expr(body) = body {
    matches!(body.as_ref(), Expr::Arrow(_))
  } else {
    false
  }
}
