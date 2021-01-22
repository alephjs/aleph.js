// Copyright 2020-2021 postUI Lab. All rights reserved. MIT license.

use crate::resolve::is_call_expr_by_name;

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
