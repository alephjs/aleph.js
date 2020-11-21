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
    signatures: Vec::<Ident>::new(),
  }
}

pub struct FastRefreshFold {
  refresh_reg: String,
  refresh_sig: String,
  signatures: Vec<Ident>,
}

impl FastRefreshFold {
  fn get_persistent_fc(
    &mut self,
    ident: &Ident,
    block_stmt: &mut BlockStmt,
  ) -> Option<(Ident, Option<(Ident, Vec<String>)>)> {
    if is_componentish_name(ident.as_ref()) {
      let mut hook_calls: Vec<String> = Vec::<String>::new();
      let stmts = &block_stmt.stmts;
      stmts.into_iter().for_each(|stmt| {
        if let Stmt::Expr(ExprStmt { span, ref expr }) = stmt {
          match &**expr {
            Expr::Call(call) => {
              let (hook_name, is_hook_call, builtin) = is_hook_call(call);
              if is_hook_call {
                let mut key = hook_name.to_owned();
                hook_calls.push(key);
              }
            }
            _ => {}
          }
        }
      });
      if hook_calls.len() > 0 {
        let mut signature_handle = String::from("_s");
        let registration_index = self.signatures.len() + 1;
        if registration_index > 1 {
          signature_handle.push_str(&registration_index.to_string());
        };
        let signature_handle = private_ident!(signature_handle.as_str());
        self.signatures.push(signature_handle.clone());
        block_stmt.stmts.insert(
          0,
          Stmt::Expr(ExprStmt {
            span: DUMMY_SP,
            expr: Box::new(Expr::Call(CallExpr {
              span: DUMMY_SP,
              callee: ExprOrSuper::Expr(Box::new(Expr::Ident(signature_handle))),
              args: vec![],
              type_args: None,
            })),
          }),
        );
      }
      Some((ident.clone(), None))
    } else {
      None
    }
  }

  fn get_persistent_fc_from_var_decl(
    &mut self,
    var_decl: &mut VarDecl,
  ) -> Option<(Ident, Option<(Ident, Vec<String>)>)> {
    match var_decl.decls.as_mut_slice() {
      // We only handle the case when a single variable is declared
      [VarDeclarator {
        name: Pat::Ident(ident),
        init: Some(init_expr),
        ..
      }] => match init_expr.as_mut() {
        Expr::Fn(FnExpr {
          function: Function {
            body: Some(body), ..
          },
          ..
        }) => self.get_persistent_fc(ident, body),
        Expr::Arrow(ArrowExpr {
          body: BlockStmtOrExpr::BlockStmt(body),
          ..
        }) => self.get_persistent_fc(ident, body),
        _ => None,
      },
      _ => None,
    }
  }
}

impl Fold for FastRefreshFold {
  noop_fold_type!();

  fn fold_module_items(&mut self, module_items: Vec<ModuleItem>) -> Vec<ModuleItem> {
    let mut items = Vec::<ModuleItem>::new();
    let mut refresh_regs = Vec::<CallExpr>::new();
    let mut registrations = Vec::<Ident>::new();

    for mut item in module_items {
      let persistent_fc: Option<(Ident, Option<(Ident, Vec<String>)>)> = match &mut item {
        // function Foo() {}
        ModuleItem::Stmt(Stmt::Decl(Decl::Fn(FnDecl {
          ident,
          function: Function {
            body: Some(body), ..
          },
          ..
        }))) => self.get_persistent_fc(ident, body),

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
        })) => self.get_persistent_fc(ident, body),

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
        })) => self.get_persistent_fc(ident, body),

        // const Foo = () => {}
        // export const Foo = () => {}
        ModuleItem::Stmt(Stmt::Decl(Decl::Var(var_decl)))
        | ModuleItem::ModuleDecl(ModuleDecl::ExportDecl(ExportDecl {
          decl: Decl::Var(var_decl),
          ..
        })) => self.get_persistent_fc_from_var_decl(var_decl),

        _ => None,
      };

      items.push(item);

      if let Some((persistent_id, ..)) = persistent_fc {
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
    // var _s, _s2;
    // ```
    if self.signatures.len() > 0 {
      items.insert(
        1,
        ModuleItem::Stmt(Stmt::Decl(Decl::Var(VarDecl {
          span: DUMMY_SP,
          kind: VarDeclKind::Var,
          declare: false,
          decls: self
            .signatures
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
      let mut i = 0;
      for signature in self.signatures.clone() {
        items.insert(
          2 + i,
          ModuleItem::Stmt(Stmt::Expr(ExprStmt {
            span: DUMMY_SP,
            expr: Box::new(Expr::Assign(AssignExpr {
              span: DUMMY_SP,
              op: AssignOp::Assign,
              left: PatOrExpr::Pat(Box::new(Pat::Ident(signature))),
              right: Box::new(Expr::Call(CallExpr {
                span: DUMMY_SP,
                callee: ExprOrSuper::Expr(Box::new(Expr::Ident(quote_ident!(self
                  .refresh_sig
                  .as_str())))),
                args: vec![],
                type_args: None,
              })),
            })),
          })),
        );
        i = i + 1;
      }
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

fn is_hook_call(call: &CallExpr) -> (String, bool, bool) {
  let callee = match &call.callee {
    ExprOrSuper::Super(_) => return ("".into(), false, false),
    ExprOrSuper::Expr(callee) => &**callee,
  };

  match callee {
    Expr::Ident(id) => {
      let id = id.sym.chars().as_str();
      let is_builtin_hook = is_builtin_hook(id);
      let is_hook_call = is_builtin_hook
        || (id.len() > 3 && id.starts_with("use") && id[3..].starts_with(char::is_uppercase));
      (id.into(), is_hook_call, is_builtin_hook)
    }
    _ => ("".into(), false, false),
  }
}

fn is_builtin_hook(id: &str) -> bool {
  match id {
    "useState"
    | "useReducer"
    | "useEffect"
    | "useLayoutEffect"
    | "useMemo"
    | "useCallback"
    | "useRef"
    | "useContext"
    | "useImperativeHandle"
    | "useDebugValue" => true,
    _ => false,
  }
}
