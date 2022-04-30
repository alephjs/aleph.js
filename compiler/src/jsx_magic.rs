use crate::resolver::{Resolver, RE_PROTOCOL_URL};
use std::cell::RefCell;
use std::rc::Rc;
use swc_common::DUMMY_SP;
use swc_ecmascript::ast::*;
use swc_ecmascript::utils::quote_ident;
use swc_ecmascript::visit::{noop_fold_type, Fold, FoldWith};

pub fn jsx_magic_fold(resolver: Rc<RefCell<Resolver>>) -> impl Fold {
  JSXMagicFold {
    resolver: resolver.clone(),
  }
}

/// Aleph JSX magic fold, functions include:
/// - resolve `<a>` to `<Anchor>`
/// - resolve `<head>` to `<Head>`
struct JSXMagicFold {
  resolver: Rc<RefCell<Resolver>>,
}

impl JSXMagicFold {
  fn fold_jsx_opening_element(&mut self, mut el: JSXOpeningElement) -> JSXOpeningElement {
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
            let mut tag = "Link";
            let mut attrs: Vec<JSXAttrOrSpread> = vec![];

            for attr in &el.attrs {
              match &attr {
                JSXAttrOrSpread::JSXAttr(attr) => {
                  if let JSXAttr {
                    name: JSXAttrName::Ident(id),
                    value: Some(JSXAttrValue::Lit(Lit::Str(Str { value, .. }))),
                    ..
                  } = attr
                  {
                    let key = id.sym.as_ref();
                    let value = value.as_ref();
                    if (key == "href" && (value.is_empty() || RE_PROTOCOL_URL.is_match(value)))
                      || (key == "target" && value == "_blank")
                    {
                      tag = "";
                      break;
                    }
                  }
                  if let JSXAttr {
                    name: JSXAttrName::Ident(id),
                    value,
                    ..
                  } = attr
                  {
                    match id.sym.as_ref() {
                      "rel" => {
                        if let Some(JSXAttrValue::Lit(Lit::Str(Str { value, .. }))) = value {
                          let value = value.as_ref().split(" ").collect::<Vec<&str>>();
                          if value.contains(&"nav") {
                            tag = "NavLink";
                          }
                          if value.contains(&"replace") {
                            attrs.push(JSXAttrOrSpread::JSXAttr(JSXAttr {
                              span: DUMMY_SP,
                              name: JSXAttrName::Ident(quote_ident!("replace")),
                              value: None,
                            }));
                          }
                          if value.contains(&"prefetch") {
                            attrs.push(JSXAttrOrSpread::JSXAttr(JSXAttr {
                              span: DUMMY_SP,
                              name: JSXAttrName::Ident(quote_ident!("prefetch")),
                              value: None,
                            }));
                          }
                          if value.contains(&"exact") {
                            attrs.push(JSXAttrOrSpread::JSXAttr(JSXAttr {
                              span: DUMMY_SP,
                              name: JSXAttrName::Ident(quote_ident!("exact")),
                              value: None,
                            }));
                          }
                        }
                        attrs.push(JSXAttrOrSpread::JSXAttr(attr.clone()));
                      }
                      "href" => {
                        attrs.push(JSXAttrOrSpread::JSXAttr(JSXAttr {
                          span: DUMMY_SP,
                          name: JSXAttrName::Ident(quote_ident!("to")),
                          value: value.clone(),
                        }));
                      }
                      "data-active-className" => {
                        attrs.push(JSXAttrOrSpread::JSXAttr(JSXAttr {
                          span: DUMMY_SP,
                          name: JSXAttrName::Ident(quote_ident!("activeClassName")),
                          value: value.clone(),
                        }));
                      }
                      "data-active-style" => {
                        attrs.push(JSXAttrOrSpread::JSXAttr(JSXAttr {
                          span: DUMMY_SP,
                          name: JSXAttrName::Ident(quote_ident!("activeStyle")),
                          value: value.clone(),
                        }));
                      }
                      _ => {
                        attrs.push(JSXAttrOrSpread::JSXAttr(attr.clone()));
                      }
                    }
                  } else {
                    attrs.push(JSXAttrOrSpread::JSXAttr(attr.clone()))
                  }
                }
                _ => attrs.push(attr.clone()),
              };
            }

            if !tag.is_empty() {
              resolver.jsx_magic_tags.insert(tag.into());
              el.name = JSXElementName::Ident(quote_ident!(format!("__ALEPH__{}", tag)));
              el.attrs = attrs;
            }
          }

          _ => {}
        }
      }
      _ => {}
    };

    el
  }
}

impl Fold for JSXMagicFold {
  noop_fold_type!();

  fn fold_jsx_element(&mut self, el: JSXElement) -> JSXElement {
    if el.span == DUMMY_SP {
      return el;
    }

    let mut children: Vec<JSXElementChild> = vec![];
    let opening = self.fold_jsx_opening_element(el.opening);

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
