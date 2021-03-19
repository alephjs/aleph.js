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

  // - `require("regenerator-runtime")` -> `(() => window.regeneratorRuntime)()`
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
                body: BlockStmtOrExpr::Expr(Box::new(Expr::MetaProp(MetaPropExpr {
                  meta: quote_ident!("window"),
                  prop: quote_ident!("regeneratorRuntime"),
                }))),
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

#[cfg(test)]
mod tests {
  use super::*;
  use crate::swc::SWC;
  use std::cmp::min;
  use swc_common::Globals;

  fn t(specifier: &str, source: &str, expect: &str) -> bool {
    let module = SWC::parse(specifier, source, None).expect("could not parse module");
    let (code, _) = swc_common::GLOBALS.set(&Globals::new(), || {
      module
        .apply_transform(compat_fixer_fold(), false)
        .expect("could not transpile module")
    });

    if code != expect {
      let mut p: usize = 0;
      for i in 0..min(code.len(), expect.len()) {
        if code.get(i..i + 1) != expect.get(i..i + 1) {
          p = i;
          break;
        }
      }
      println!(
        "{}\x1b[0;31m{}\x1b[0m",
        code.get(0..p).unwrap(),
        code.get(p..).unwrap()
      );
    }
    code == expect
  }

  #[test]
  fn fast_refresh() {
    let source = r#"require("regenerator-runtime")
const { mark } = require("regenerator-runtime")
    "#;
    let expect = r#"(()=>window.regeneratorRuntime
)();
const { mark  } = (()=>window.regeneratorRuntime
)();
"#;
    assert!(t("/app.js", source, expect));
  }
}
