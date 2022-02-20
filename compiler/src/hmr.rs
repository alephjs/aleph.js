use crate::expr_utils::{
  import_name, is_call_expr_by_name, new_member_expr, new_str, pat_id, rename_var_decl, simple_member_expr,
  window_assign,
};
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
    let resolver = self.resolver.borrow();
    let mut items = Vec::<ModuleItem>::new();
    let mut react_refresh = false;
    let aleph_pkg_uri = resolver.aleph_pkg_uri.to_owned();

    // import __CREATE_HOT_CONTEXT__ from "$aleph_pkg_uri/framework/core/hmr.ts"
    items.push(ModuleItem::ModuleDecl(ModuleDecl::Import(ImportDecl {
      span: DUMMY_SP,
      specifiers: vec![ImportSpecifier::Default(ImportDefaultSpecifier {
        span: DUMMY_SP,
        local: quote_ident!("__CREATE_HOT_CONTEXT__"),
      })],
      src: new_str(&resolver.to_local_path(&(aleph_pkg_uri + "/framework/core/hmr.ts"))),
      type_only: false,
      asserts: None,
    })));
    // import.meta.hot = __CREATE_HOT_CONTEXT__($specifier)
    items.push(ModuleItem::Stmt(Stmt::Expr(ExprStmt {
      span: DUMMY_SP,
      expr: Box::new(Expr::Assign(AssignExpr {
        span: DUMMY_SP,
        op: AssignOp::Assign,
        left: PatOrExpr::Expr(Box::new(new_member_expr(simple_member_expr("import", "meta"), "hot"))),
        right: Box::new(Expr::Call(CallExpr {
          span: DUMMY_SP,
          callee: Callee::Expr(Box::new(Expr::Ident(quote_ident!("__CREATE_HOT_CONTEXT__")))),
          args: vec![ExprOrSpread {
            spread: None,
            expr: Box::new(Expr::Lit(Lit::Str(new_str(&resolver.specifier)))),
          }],
          type_args: None,
        })),
      })),
    })));

    for item in &module_items {
      if let ModuleItem::Stmt(Stmt::Expr(ExprStmt { expr, .. })) = &item {
        if let Expr::Call(call) = expr.as_ref() {
          if is_call_expr_by_name(&call, "$RefreshReg$") {
            react_refresh = true;
            break;
          }
        }
      }
    }

    if react_refresh {
      let aleph_pkg_uri = resolver.aleph_pkg_uri.to_owned();
      // import { __REACT_REFRESH_RUNTIME__, __REACT_REFRESH__ } from "$aleph_pkg_uri/framework/react/refresh.ts"
      items.push(ModuleItem::ModuleDecl(ModuleDecl::Import(ImportDecl {
        span: DUMMY_SP,
        specifiers: vec![
          import_name("__REACT_REFRESH_RUNTIME__"),
          import_name("__REACT_REFRESH__"),
        ],
        src: new_str(&resolver.to_local_path(&(aleph_pkg_uri + "/framework/react/refresh.ts"))),
        type_only: false,
        asserts: None,
      })));
      // const prevRefreshReg = $RefreshReg$
      items.push(rename_var_decl("prevRefreshReg", "$RefreshReg$"));
      // const prevRefreshSig = $RefreshSig$
      items.push(rename_var_decl("prevRefreshSig", "$RefreshSig$"));
      // window.$RefreshReg$ = (type, id) => __REACT_REFRESH_RUNTIME__.register(type, $specifier + "#" + id);
      items.push(window_assign(
        "$RefreshReg$",
        Expr::Arrow(ArrowExpr {
          span: DUMMY_SP,
          params: vec![pat_id("type"), pat_id("id")],
          body: BlockStmtOrExpr::Expr(Box::new(Expr::Call(CallExpr {
            span: DUMMY_SP,
            callee: Callee::Expr(Box::new(simple_member_expr("__REACT_REFRESH_RUNTIME__", "register"))),
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
      ));
      // window.$RefreshSig$ = __REACT_REFRESH_RUNTIME__.createSignatureFunctionForTransform
      items.push(window_assign(
        "$RefreshSig$",
        simple_member_expr("__REACT_REFRESH_RUNTIME__", "createSignatureFunctionForTransform"),
      ));
    }

    for item in module_items {
      items.push(item);
    }

    if react_refresh {
      // window.$RefreshReg$ = prevRefreshReg
      items.push(window_assign(
        "$RefreshReg$",
        Expr::Ident(quote_ident!("prevRefreshReg")),
      ));
      // window.$RefreshSig$ = prevRefreshSig
      items.push(window_assign(
        "$RefreshSig$",
        Expr::Ident(quote_ident!("prevRefreshSig")),
      ));
      // import.meta.hot.accept(__REACT_REFRESH__)
      items.push(ModuleItem::Stmt(Stmt::Expr(ExprStmt {
        span: DUMMY_SP,
        expr: Box::new(Expr::Call(CallExpr {
          span: DUMMY_SP,
          callee: Callee::Expr(Box::new(Expr::OptChain(OptChainExpr {
            span: DUMMY_SP,
            question_dot_token: DUMMY_SP,
            expr: Box::new(new_member_expr(
              new_member_expr(simple_member_expr("import", "meta"), "hot"),
              "accept",
            )),
          }))),
          args: vec![ExprOrSpread {
            spread: None,
            expr: Box::new(Expr::Ident(quote_ident!("__REACT_REFRESH__"))),
          }],
          type_args: None,
        })),
      })));
    }

    items
  }
}
