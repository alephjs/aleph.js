use crate::resolver::Resolver;
use std::{cell::RefCell, rc::Rc};
use swc_ecma_ast::*;
use swc_ecma_visit::{noop_fold_type, Fold, FoldWith};

pub fn jsx_attr_fold(resolver: Rc<RefCell<Resolver>>) -> impl Fold {
  JSXAttrFold {
    resolver: resolver.clone(),
  }
}

/// Aleph JSX attr fold, functions include:
/// - mark JSX static class names (for atomic css like tailwindcss)
struct JSXAttrFold {
  resolver: Rc<RefCell<Resolver>>,
}

impl JSXAttrFold {
  // mark static classnames for windicss
  fn mark_class_name(&mut self, expr: &Expr) {
    match expr {
      Expr::Lit(Lit::Str(Str { value, .. })) => {
        let s = value.as_ref();
        if s != "" {
          self.resolver.borrow_mut().jsx_static_classes.insert(s.into());
        }
      }
      Expr::Lit(Lit::JSXText(JSXText { value, .. })) => {
        let s = value.as_ref();
        if s != "" {
          self.resolver.borrow_mut().jsx_static_classes.insert(s.into());
        }
      }
      Expr::Paren(ParenExpr { expr, .. }) => {
        self.mark_class_name(expr.as_ref());
      }
      Expr::Cond(CondExpr { cons, alt, .. }) => {
        self.mark_class_name(&cons);
        self.mark_class_name(&alt);
      }
      Expr::Bin(BinExpr { op, left, right, .. }) => {
        if *op == BinaryOp::Add {
          self.mark_class_name(&left);
          self.mark_class_name(&right);
        }
      }
      Expr::Tpl(Tpl { exprs, quasis, .. }) => {
        for expr in exprs {
          self.mark_class_name(&expr);
        }
        let mut resolver = self.resolver.borrow_mut();
        for quasi in quasis {
          let s = quasi.raw.value.as_ref();
          if s != "" {
            resolver.jsx_static_classes.insert(s.into());
          }
        }
      }
      _ => {}
    }
  }

  fn fold_jsx_opening_element(&mut self, el: &JSXOpeningElement) {
    // record jsx static class names
    for (_index, attr) in el.attrs.iter().enumerate() {
      match attr {
        JSXAttrOrSpread::JSXAttr(JSXAttr {
          name: JSXAttrName::Ident(id),
          value: Some(value),
          ..
        }) => {
          if id.sym.eq("class") || id.sym.eq("className") {
            match value {
              JSXAttrValue::Lit(lit) => {
                self.mark_class_name(&Expr::Lit(lit.clone()));
              }
              JSXAttrValue::JSXExprContainer(JSXExprContainer { expr, .. }) => {
                if let JSXExpr::Expr(expr) = expr {
                  self.mark_class_name(expr.as_ref());
                }
              }
              _ => {}
            };
            break;
          }
        }
        _ => {}
      };
    }
  }
}

impl Fold for JSXAttrFold {
  noop_fold_type!();

  fn fold_jsx_element(&mut self, el: JSXElement) -> JSXElement {
    self.fold_jsx_opening_element(&el.opening);

    for child in el.children.clone() {
      child.fold_children_with(self);
    }

    el
  }
}
