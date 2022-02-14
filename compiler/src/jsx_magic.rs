use crate::resolver::{InlineStyle, Resolver, RE_PROTOCOL_URL};
use sha1::{Digest, Sha1};
use std::{cell::RefCell, rc::Rc};
use swc_common::{SourceMap, Spanned, DUMMY_SP};
use swc_ecma_ast::*;
use swc_ecma_utils::quote_ident;
use swc_ecma_visit::{noop_fold_type, Fold, FoldWith};

pub fn jsx_magic_fold(resolver: Rc<RefCell<Resolver>>, source: Rc<SourceMap>) -> impl Fold {
  JSXMagicFold {
    resolver: resolver.clone(),
    source,
    inline_style_idx: 0,
  }
}

/// Aleph JSX magic fold, functions include:
/// - resolve `<a>` to `<Anchor>`
/// - resolve `<head>` to `<Head>`
/// - resolve `<style>` to `<InlineStyle>`
/// - mark JSX static class names (for atomic css like tailwindcss)
struct JSXMagicFold {
  resolver: Rc<RefCell<Resolver>>,
  source: Rc<SourceMap>,
  inline_style_idx: i32,
}

impl JSXMagicFold {
  fn new_inline_style_ident(&mut self) -> String {
    let resolver = self.resolver.borrow();
    let mut ident: String = "inline-style-".to_owned();
    let mut hasher = Sha1::new();
    self.inline_style_idx = self.inline_style_idx + 1;
    hasher.update(resolver.specifier.clone());
    hasher.update(self.inline_style_idx.to_string());
    ident.push_str(
      base64::encode(hasher.finalize())
        .replace("+", "")
        .replace("/", "")
        .replace("=", "")
        .as_str(),
    );
    ident
  }

  // mark static classnames for windicss
  fn mark_class_name(&mut self, expr: Box<Expr>) {
    match expr.as_ref() {
      Expr::Lit(Lit::Str(Str { value, .. })) => {
        let s = value.as_ref();
        if s != "" {
          self.resolver.borrow_mut().jsx_static_class_names.insert(s.into());
        }
      }
      Expr::Lit(Lit::JSXText(JSXText { value, .. })) => {
        let s = value.as_ref();
        if s != "" {
          self.resolver.borrow_mut().jsx_static_class_names.insert(s.into());
        }
      }
      Expr::Cond(CondExpr { cons, alt, .. }) => {
        self.mark_class_name(cons.clone());
        self.mark_class_name(alt.clone());
      }
      Expr::Bin(BinExpr { op, left, right, .. }) => {
        if *op == BinaryOp::Add {
          self.mark_class_name(left.clone());
          self.mark_class_name(right.clone());
        }
      }
      Expr::Tpl(Tpl { exprs, quasis, .. }) => {
        for expr in exprs {
          self.mark_class_name(expr.clone());
        }
        let mut resolver = self.resolver.borrow_mut();
        for quasi in quasis {
          let s = quasi.raw.value.as_ref();
          if s != "" {
            resolver.jsx_static_class_names.insert(s.into());
          }
        }
      }
      _ => {}
    }
  }

  fn fold_jsx_opening_element(&mut self, mut el: JSXOpeningElement) -> (JSXOpeningElement, Option<(String, String)>) {
    let mut inline_style: Option<(String, String)> = None;

    // jsx magic
    match &el.name {
      JSXElementName::Ident(id) => {
        let name = id.sym.as_ref();
        match name {
          "head" => {
            let mut resolver = self.resolver.borrow_mut();
            resolver.jsx_magic_tags.insert("Head".into());
            el.name = JSXElementName::Ident(quote_ident!("__ALEPH__Head"));
          }

          "a" => {
            let mut resolver = self.resolver.borrow_mut();
            let mut should_replace = true;

            for attr in &el.attrs {
              match &attr {
                JSXAttrOrSpread::JSXAttr(JSXAttr {
                  name: JSXAttrName::Ident(id),
                  value: Some(JSXAttrValue::Lit(Lit::Str(Str { value, .. }))),
                  ..
                }) => {
                  let key = id.sym.as_ref();
                  let value = value.as_ref();
                  if (key == "href" && RE_PROTOCOL_URL.is_match(value)) || (key == "target" && value == "_blank") {
                    should_replace = false
                  }
                }
                _ => {}
              };
            }

            if should_replace {
              resolver.jsx_magic_tags.insert("Anchor".into());
              el.name = JSXElementName::Ident(quote_ident!("__ALEPH__Anchor"));
            }
          }

          "style" => {
            let mut id_prop_index: i32 = -1;
            let mut type_prop_value = "css".to_owned();

            for (i, attr) in el.attrs.iter().enumerate() {
              match &attr {
                JSXAttrOrSpread::JSXAttr(JSXAttr {
                  name: JSXAttrName::Ident(id),
                  value: Some(JSXAttrValue::Lit(Lit::Str(Str { value, .. }))),
                  ..
                }) => match id.sym.as_ref() {
                  "__styleId" => {
                    id_prop_index = i as i32;
                  }
                  "type" => {
                    type_prop_value = value.as_ref().trim_start_matches("text/").to_string();
                  }
                  _ => {}
                },
                _ => continue,
              };
            }

            let id = self.new_inline_style_ident();
            let id_attr = JSXAttrOrSpread::JSXAttr(JSXAttr {
              span: DUMMY_SP,
              name: JSXAttrName::Ident(quote_ident!("__styleId")),
              value: Some(JSXAttrValue::Lit(Lit::Str(Str {
                span: DUMMY_SP,
                value: id.clone().into(),
                has_escape: false,
                kind: Default::default(),
              }))),
            });
            if id_prop_index >= 0 {
              el.attrs[id_prop_index as usize] = id_attr;
            } else {
              el.attrs.push(id_attr);
            }

            let mut resolver = self.resolver.borrow_mut();
            resolver.jsx_magic_tags.insert("InlineStyle".into());
            el.name = JSXElementName::Ident(quote_ident!("__ALEPH__InlineStyle"));
            inline_style = Some((type_prop_value, id.into()));
          }

          _ => {}
        }
      }
      _ => {}
    };

    // record jsx static class names
    for (_index, attr) in el.attrs.iter().enumerate() {
      match &attr {
        JSXAttrOrSpread::JSXAttr(JSXAttr {
          name: JSXAttrName::Ident(id),
          value: Some(value),
          ..
        }) => {
          if id.sym.eq("className") {
            match value {
              JSXAttrValue::Lit(lit) => {
                self.mark_class_name(Box::new(Expr::Lit(lit.clone())));
              }
              JSXAttrValue::JSXExprContainer(JSXExprContainer { expr, .. }) => {
                if let JSXExpr::Expr(expr) = expr {
                  self.mark_class_name(expr.clone());
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

    (el, inline_style)
  }
}

impl Fold for JSXMagicFold {
  noop_fold_type!();

  fn fold_jsx_element(&mut self, mut el: JSXElement) -> JSXElement {
    if el.span == DUMMY_SP {
      return el;
    }

    let mut children: Vec<JSXElementChild> = vec![];
    let (opening, inline_style) = self.fold_jsx_opening_element(el.opening);

    match inline_style {
      Some(ref inline_style) => {
        if el.children.len() == 1 {
          match el.children.first().unwrap() {
            JSXElementChild::JSXExprContainer(JSXExprContainer {
              expr: JSXExpr::Expr(expr),
              ..
            }) => match expr.as_ref() {
              Expr::Tpl(Tpl { exprs, quasis, .. }) => {
                let mut resolver = self.resolver.borrow_mut();
                let mut es: Vec<String> = vec![];
                let mut qs: Vec<String> = vec![];
                for expr in exprs {
                  let raw = self.source.span_to_snippet(expr.as_ref().span().clone()).unwrap();
                  es.push(raw.into());
                }
                for quasi in quasis {
                  qs.push(quasi.raw.value.to_string());
                }
                let (t, id) = inline_style;
                resolver.jsx_inline_styles.insert(
                  id.into(),
                  InlineStyle {
                    r#type: t.into(),
                    exprs: es,
                    quasis: qs,
                  },
                );
                el.children = vec![JSXElementChild::JSXExprContainer(JSXExprContainer {
                  span: DUMMY_SP,
                  expr: JSXExpr::Expr(Box::new(Expr::Lit(Lit::Str(Str {
                    span: DUMMY_SP,
                    value: format!("%%{}-placeholder%%", id).into(),
                    has_escape: false,
                    kind: Default::default(),
                  })))),
                })];
              }
              _ => {}
            },
            _ => {}
          }
        }
      }
      _ => {}
    }

    for child in el.children {
      children.push(child.fold_children_with(self));
    }

    JSXElement {
      span: DUMMY_SP,
      opening,
      children,
      ..el
    }
  }
}
