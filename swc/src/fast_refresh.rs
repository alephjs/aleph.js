// Copyright 2017-2020 The swc Project Developers. All rights reserved. MIT license.
// Copyright 2020 the Aleph.js authors. All rights reserved. MIT license.

// @ref https://github.com/facebook/react/blob/master/packages/react-refresh/src/ReactFreshBabelPlugin.js
// @ref https://github.com/vovacodes/swc/tree/feature/transform-react-fast-refresh

use swc_common::DUMMY_SP;
use swc_ecma_ast::*;
use swc_ecma_utils::{private_ident, quote_ident};
use swc_ecma_visit::{noop_fold_type, Fold};

pub fn fast_refresh_fold(refresh_reg: &str, refresh_sig: &str) -> impl Fold {
  FastRefreshFold {
    refresh_reg: refresh_reg.into(),
    refresh_sig: refresh_sig.into(),
  }
}

pub struct FastRefreshFold {
  refresh_reg: String,
  refresh_sig: String,
}

impl Fold for FastRefreshFold {
  noop_fold_type!();

  fn fold_module_items(&mut self, module_items: Vec<ModuleItem>) -> Vec<ModuleItem> {
    let mut items = Vec::<ModuleItem>::new();
    let mut refresh_regs = Vec::<CallExpr>::new();
    let mut registrations = Vec::<Ident>::new();

    for item in module_items {
      let persistent_id: Option<Ident> = match &item {
        // function Foo() {}
        ModuleItem::Stmt(Stmt::Decl(Decl::Fn(FnDecl {
          ident,
          function: Function {
            body: Some(body), ..
          },
          ..
        }))) => get_persistent_fc(ident, body),

        // export function Foo() {}
        ModuleItem::ModuleDecl(ModuleDecl::ExportDecl(ExportDecl {
          decl:
            Decl::Fn(FnDecl {
              ident,
              function: Function {
                body: Some(body), ..
              },
              ..
            }),
          ..
        })) => get_persistent_fc(ident, body),

        // export default function Foo() {}
        ModuleItem::ModuleDecl(ModuleDecl::ExportDefaultDecl(ExportDefaultDecl {
          decl:
            DefaultDecl::Fn(FnExpr {
              // We don't currently handle anonymous default exports.
              ident: Some(ident),
              function: Function {
                body: Some(body), ..
              },
              ..
            }),
          ..
        })) => get_persistent_fc(ident, body),

        // const Foo = () => {}
        // export const Foo = () => {}
        ModuleItem::Stmt(Stmt::Decl(Decl::Var(var_decl)))
        | ModuleItem::ModuleDecl(ModuleDecl::ExportDecl(ExportDecl {
          decl: Decl::Var(var_decl),
          ..
        })) => get_persistent_fc_from_var_decl(var_decl),

        _ => None,
      };

      items.push(item);

      if let Some(persistent_id) = persistent_id {
        let mut registration_handle = String::from("_c");
        let registration_index = registrations.len() + 1;
        if registration_index > 1 {
          registration_handle.push_str(&registration_index.to_string());
        };
        let registration_handle = private_ident!(registration_handle.as_str());

        registrations.push(registration_handle.clone());

        // $RefreshReg$(_c, "Hello");
        refresh_regs.push(CallExpr {
          span: DUMMY_SP,
          callee: ExprOrSuper::Expr(Box::new(Expr::Ident(quote_ident!(self
            .refresh_reg
            .as_str())))),
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
    if registrations.len() > 0 {
      items.insert(
        0,
        ModuleItem::Stmt(Stmt::Decl(Decl::Var(VarDecl {
          span: DUMMY_SP,
          kind: VarDeclKind::Var,
          declare: false,
          decls: registrations
            .clone()
            .into_iter()
            .map(|handle| VarDeclarator {
              span: DUMMY_SP,
              name: Pat::Ident(handle),
              init: None,
              definite: false,
            })
            .collect(),
        }))),
      );
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

fn get_persistent_fc(ident: &Ident, block_stmt: &BlockStmt) -> Option<Ident> {
  if is_componentish_name(ident.as_ref()) {
    Some(ident.clone())
  } else {
    None
  }
}

fn get_persistent_fc_from_var_decl(var_decl: &VarDecl) -> Option<Ident> {
  match var_decl.decls.as_slice() {
    // We only handle the case when a single variable is declared
    [VarDeclarator {
      name: Pat::Ident(ident),
      init: Some(init_expr),
      ..
    }] => match init_expr.as_ref() {
      Expr::Fn(FnExpr {
        function: Function {
          body: Some(body), ..
        },
        ..
      }) => get_persistent_fc(ident, body),
      Expr::Arrow(ArrowExpr {
        body: BlockStmtOrExpr::BlockStmt(body),
        ..
      }) => get_persistent_fc(ident, body),
      _ => None,
    },
    _ => None,
  }
}
