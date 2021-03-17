use crate::resolve_fold::is_call_expr_by_name;

use swc_common::DUMMY_SP;
use swc_ecma_ast::*;
use swc_ecma_utils::quote_ident;
use swc_ecma_visit::{noop_fold_type, Fold};

pub fn compat_fixer_fold() -> impl Fold {
  CompatFixer {}
}

struct CompatFixer {}

impl Fold for CompatFixer {
  noop_fold_type!();

  // - `require("regenerator-runtime")` -> `(() => regeneratorRuntime)()`
  fn fold_call_expr(&mut self, call: CallExpr) -> CallExpr {
    if is_call_expr_by_name(&call, "require") {
      let name = match call.args.first() {
        Some(ExprOrSpread { expr, .. }) => match expr.as_ref() {
          Expr::Lit(lit) => match lit {
            Lit::Str(s) => s.value.as_ref(),
            _ => "",
          },
          _ => "",
        },
        _ => "",
      };
      match name {
        "regenerator-runtime" => {
          return CallExpr {
            span: DUMMY_SP,
            callee: ExprOrSuper::Expr(Box::new(Expr::Paren(ParenExpr {
              span: DUMMY_SP,
              expr: Box::new(Expr::Arrow(ArrowExpr {
                span: DUMMY_SP,
                params: vec![],
                body: BlockStmtOrExpr::Expr(Box::new(Expr::Ident(quote_ident!(
                  "regeneratorRuntime"
                )))),
                is_async: false,
                is_generator: false,
                type_params: None,
                return_type: None,
              })),
            }))),
            args: vec![],
            type_args: None,
          };
        }
        _ => {}
      }
    }
    call
  }
}
