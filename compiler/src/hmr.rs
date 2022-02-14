use crate::resolver::Resolver;
use std::{cell::RefCell, rc::Rc};
use swc_common::DUMMY_SP;
use swc_ecma_ast::*;
use swc_ecma_utils::quote_ident;
use swc_ecma_visit::{noop_fold_type, Fold};

pub fn hmr(resolver: Rc<RefCell<Resolver>>) -> impl Fold {
  HmrFold { resolver }
}

pub struct HmrFold {
  resolver: Rc<RefCell<Resolver>>,
}

impl Fold for HmrFold {
  noop_fold_type!();

  // resolve import/export url
  fn fold_module_items(&mut self, module_items: Vec<ModuleItem>) -> Vec<ModuleItem> {
    let mut items = Vec::<ModuleItem>::new();
    let mut hmr = false;

    for item in &module_items {
      if let ModuleItem::Stmt(Stmt::Expr(ExprStmt { expr, .. })) = &item {
        if let Expr::Call(call) = expr.as_ref() {
          if is_call_expr_by_name(&call, "$RefreshReg$") {
            hmr = true;
            break;
          }
        }
      }
    }

    if hmr {
      let resolver = self.resolver.borrow();
      items.push(ModuleItem::ModuleDecl(ModuleDecl::Import(ImportDecl {
        span: DUMMY_SP,
        specifiers: vec![
          ImportSpecifier::Named(ImportNamedSpecifier {
            span: DUMMY_SP,
            local: quote_ident!("__REACT_REFRESH_RUNTIME__"),
            imported: None,
            is_type_only: false,
          }),
          ImportSpecifier::Named(ImportNamedSpecifier {
            span: DUMMY_SP,
            local: quote_ident!("__REACT_REFRESH__"),
            imported: None,
            is_type_only: false,
          }),
        ],
        src: new_str("/-/react-refresh-runtime.js"),
        type_only: false,
        asserts: None,
      }))); // import { __REACT_REFRESH_RUNTIME__, __REACT_REFRESH__ } from "/-/react-refresh-runtime.js"
      items.push(rename_var_decl("prevRefreshReg", "$RefreshReg$")); // const prevRefreshReg = $RefreshReg$
      items.push(rename_var_decl("prevRefreshSig", "$RefreshSig$")); // const prevRefreshSig = $RefreshSig$
      items.push(rename_assign(
        "$RefreshReg$",
        Expr::Arrow(ArrowExpr {
          span: DUMMY_SP,
          params: vec![pat_id("type"), pat_id("id")],
          body: BlockStmtOrExpr::Expr(Box::new(Expr::Call(CallExpr {
            span: DUMMY_SP,
            callee: Callee::Expr(Box::new(Expr::Member(MemberExpr {
              span: DUMMY_SP,
              obj: Box::new(Expr::Ident(quote_ident!("__REACT_REFRESH_RUNTIME__"))),
              prop: MemberProp::Ident(quote_ident!("register")),
            }))),
            args: vec![
              ExprOrSpread {
                spread: None,
                expr: Box::new(Expr::Ident(quote_ident!("type"))),
              },
              ExprOrSpread {
                spread: None,
                expr: Box::new(Expr::Bin(BinExpr {
                  span: DUMMY_SP,
                  op: BinaryOp::Add,
                  left: Box::new(Expr::Lit(Lit::Str(new_str(&resolver.specifier)))),
                  right: Box::new(Expr::Bin(BinExpr {
                    span: DUMMY_SP,
                    op: BinaryOp::Add,
                    left: Box::new(Expr::Lit(Lit::Str(new_str("#")))),
                    right: Box::new(Expr::Ident(quote_ident!("id"))),
                  })),
                })),
              },
            ],
            type_args: None,
          }))),
          is_async: false,
          is_generator: false,
          type_params: None,
          return_type: None,
        }),
      )); // window.$RefreshReg$ = (type, id) => __REACT_REFRESH_RUNTIME__.register(type, ${JSON.stringify(specifier)} + "#" + id);
      items.push(rename_assign(
        "$RefreshSig$",
        Expr::Member(MemberExpr {
          span: DUMMY_SP,
          obj: Box::new(Expr::Ident(quote_ident!("__REACT_REFRESH_RUNTIME__"))),
          prop: MemberProp::Ident(quote_ident!("createSignatureFunctionForTransform")),
        }),
      )); // window.$RefreshSig$ = __REACT_REFRESH_RUNTIME__.createSignatureFunctionForTransform
    }

    for item in module_items {
      items.push(item);
    }

    if hmr {
      items.push(rename_assign(
        "$RefreshReg$",
        Expr::Ident(quote_ident!("prevRefreshReg")),
      )); // window.$RefreshReg$ = prevRefreshReg
      items.push(rename_assign(
        "$RefreshSig$",
        Expr::Ident(quote_ident!("prevRefreshSig")),
      )); // window.$RefreshSig$ = prevRefreshSig
      items.push(ModuleItem::Stmt(Stmt::Expr(ExprStmt {
        span: DUMMY_SP,
        expr: Box::new(Expr::Call(CallExpr {
          span: DUMMY_SP,
          callee: Callee::Expr(Box::new(Expr::OptChain(OptChainExpr {
            span: DUMMY_SP,
            question_dot_token: DUMMY_SP,
            expr: Box::new(Expr::Member(MemberExpr {
              span: DUMMY_SP,
              obj: Box::new(Expr::Member(MemberExpr {
                span: DUMMY_SP,
                obj: Box::new(Expr::Member(MemberExpr {
                  span: DUMMY_SP,
                  obj: Box::new(Expr::Ident(quote_ident!("import"))),
                  prop: MemberProp::Ident(quote_ident!("meta")),
                })),
                prop: MemberProp::Ident(quote_ident!("hot")),
              })),
              prop: MemberProp::Ident(quote_ident!("accept")),
            })),
          }))),
          args: vec![ExprOrSpread {
            spread: None,
            expr: Box::new(Expr::Ident(quote_ident!("__REACT_REFRESH__"))),
          }],
          type_args: None,
        })),
      }))); // import.meta.hot.accept(__REACT_REFRESH__)
    }

    items
  }
}

pub fn is_call_expr_by_name(call: &CallExpr, name: &str) -> bool {
  let callee = match &call.callee {
    Callee::Super(_) => return false,
    Callee::Import(_) => return false,
    Callee::Expr(callee) => callee.as_ref(),
  };

  match callee {
    Expr::Ident(id) => id.sym.as_ref().eq(name),
    _ => false,
  }
}

fn rename_var_decl(new_name: &str, old: &str) -> ModuleItem {
  ModuleItem::Stmt(Stmt::Decl(Decl::Var(VarDecl {
    span: DUMMY_SP,
    kind: VarDeclKind::Const,
    declare: false,
    decls: vec![VarDeclarator {
      span: DUMMY_SP,
      name: pat_id(new_name),
      init: Some(Box::new(Expr::Ident(quote_ident!(old)))),
      definite: false,
    }],
  })))
}

fn rename_assign(name: &str, expr: Expr) -> ModuleItem {
  ModuleItem::Stmt(Stmt::Expr(ExprStmt {
    span: DUMMY_SP,
    expr: Box::new(Expr::Assign(AssignExpr {
      span: DUMMY_SP,
      op: AssignOp::Assign,
      left: PatOrExpr::Expr(Box::new(Expr::Member(MemberExpr {
        span: DUMMY_SP,
        obj: Box::new(Expr::Ident(quote_ident!("window"))),
        prop: MemberProp::Ident(quote_ident!(name)),
      }))),
      right: Box::new(expr),
    })),
  }))
}

fn pat_id(id: &str) -> Pat {
  Pat::Ident(BindingIdent {
    id: quote_ident!(id),
    type_ann: None,
  })
}

fn new_str(s: &str) -> Str {
  Str {
    span: DUMMY_SP,
    value: s.into(),
    has_escape: false,
    kind: Default::default(),
  }
}
