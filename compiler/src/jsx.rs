use crate::resolve_fold::RE_CSS_MODULES;
use crate::resolver::{is_remote_url, InlineStyle, Resolver};
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

pub fn jsx_magic_pass_2_fold(
  resolver: Rc<RefCell<Resolver>>,
  source: Rc<SourceMap>,
  is_dev: bool,
) -> impl Fold {
  JSXMagicPass2Fold {
    resolver: resolver.clone(),
    source,
    is_dev,
  }
}

/// JSX magic fold, core functions include:
/// - add `__sourceFile` prop in development mode
/// - resolve `a` to `Anchor`
/// - resolve `head` to `Head`
/// - resolve `link` to `StyleLink`
/// - resolve `style` to `InlineStyle`
/// - resolve `script` to `CustomScript`
/// - optimize `img` in producation mode
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

  fn fold_jsx_opening_element(
    &mut self,
    mut el: JSXOpeningElement,
  ) -> (JSXOpeningElement, Option<(String, String)>) {
    let mut inline_style: Option<(String, String)> = None;

    match &el.name {
      JSXElementName::Ident(id) => {
        let name = id.sym.as_ref();
        match name {
          "head" => {
            let mut resolver = self.resolver.borrow_mut();
            resolver.used_builtin_jsx_tags.insert("Head".into());
            el.name = JSXElementName::Ident(quote_ident!("__ALEPH__Head"));
          }

          "script" => {
            let mut resolver = self.resolver.borrow_mut();
            resolver.used_builtin_jsx_tags.insert("CustomScript".into());
            el.name = JSXElementName::Ident(quote_ident!("__ALEPH__CustomScript"));
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
                  if (key == "href" && is_remote_url(value))
                    || (key == "target" && value == "_blank")
                  {
                    should_replace = false
                  }
                }
                _ => {}
              };
            }

            if should_replace {
              resolver.used_builtin_jsx_tags.insert("Anchor".into());
              el.name = JSXElementName::Ident(quote_ident!("__ALEPH__Anchor"));
            }
          }

          "link" => {
            let mut should_replace = false;

            for attr in &el.attrs {
              match &attr {
                JSXAttrOrSpread::JSXAttr(JSXAttr {
                  name: JSXAttrName::Ident(id),
                  value: Some(JSXAttrValue::Lit(Lit::Str(Str { value, .. }))),
                  ..
                }) => {
                  if id.sym.eq("rel") && (value.eq("stylesheet") || value.eq("style")) {
                    should_replace = true;
                    break;
                  }
                }
                _ => {}
              };
            }

            if should_replace {
              let mut href_prop_index: i32 = -1;
              let mut href_prop_value = "";

              for (i, attr) in el.attrs.iter().enumerate() {
                match &attr {
                  JSXAttrOrSpread::JSXAttr(JSXAttr {
                    name: JSXAttrName::Ident(id),
                    value: Some(JSXAttrValue::Lit(Lit::Str(Str { value, .. }))),
                    ..
                  }) => match id.sym.as_ref() {
                    "href" => {
                      href_prop_index = i as i32;
                      href_prop_value = value.as_ref();
                    }
                    _ => {}
                  },
                  _ => continue,
                };
              }

              let mut resolver = self.resolver.borrow_mut();
              let (resolved_path, fixed_url) = resolver.resolve(href_prop_value, false);
              resolver.add_extra_import(resolved_path.as_str());

              if href_prop_index >= 0 {
                el.attrs[href_prop_index as usize] = JSXAttrOrSpread::JSXAttr(JSXAttr {
                  span: DUMMY_SP,
                  name: JSXAttrName::Ident(quote_ident!("href")),
                  value: Some(JSXAttrValue::Lit(Lit::Str(Str {
                    span: DUMMY_SP,
                    value: fixed_url.into(),
                    has_escape: false,
                    kind: Default::default(),
                  }))),
                });
              }

              if name.eq("link") {
                resolver.used_builtin_jsx_tags.insert("StyleLink".into());
                el.name = JSXElementName::Ident(quote_ident!("__ALEPH__StyleLink"));
              }
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
            resolver.used_builtin_jsx_tags.insert("InlineStyle".into());
            el.name = JSXElementName::Ident(quote_ident!("__ALEPH__InlineStyle"));
            inline_style = Some((type_prop_value, id.into()));
          }

          "img" => {
            //todo: optimize img
          }

          _ => {}
        }
      }
      _ => {}
    };

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
                  let raw = self
                    .source
                    .span_to_snippet(expr.as_ref().span().clone())
                    .unwrap();
                  es.push(raw.into());
                }
                for quasi in quasis {
                  qs.push(quasi.raw.value.to_string());
                }
                let (t, id) = inline_style;
                resolver.inline_styles.insert(
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

struct JSXMagicPass2Fold {
  resolver: Rc<RefCell<Resolver>>,
  source: Rc<SourceMap>,
  is_dev: bool,
}

impl JSXMagicPass2Fold {
  fn record_jsx_class_name(&mut self, expr: Box<Expr>) {
    match expr.as_ref() {
      Expr::Lit(Lit::Str(Str { value, .. })) => {
        let s = value.as_ref();
        if s != "" {
          self
            .resolver
            .borrow_mut()
            .jsx_static_class_names
            .insert(s.into());
        }
      }
      Expr::Lit(Lit::JSXText(JSXText { value, .. })) => {
        let s = value.as_ref();
        if s != "" {
          self
            .resolver
            .borrow_mut()
            .jsx_static_class_names
            .insert(s.into());
        }
      }
      Expr::Cond(CondExpr { cons, alt, .. }) => {
        self.record_jsx_class_name(cons.clone());
        self.record_jsx_class_name(alt.clone());
      }
      Expr::Bin(BinExpr {
        op, left, right, ..
      }) => {
        if *op == BinaryOp::Add {
          self.record_jsx_class_name(left.clone());
          self.record_jsx_class_name(right.clone());
        }
      }
      Expr::Tpl(Tpl { exprs, quasis, .. }) => {
        for expr in exprs {
          self.record_jsx_class_name(expr.clone());
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

  fn fold_jsx_opening_element(&mut self, mut el: JSXOpeningElement) -> JSXOpeningElement {
    let extra_imports = self.resolver.borrow().extra_imports.clone();
    let mut css_modules = false;

    for imp in extra_imports {
      if RE_CSS_MODULES.is_match(imp.as_str()) {
        css_modules = true;
        break;
      }
    }

    let mut class_name_index: Option<usize> = None;
    let mut class_name_cx_expr: Option<Box<Expr>> = None;

    for (index, attr) in el.attrs.iter().enumerate() {
      match &attr {
        JSXAttrOrSpread::JSXAttr(JSXAttr {
          name: JSXAttrName::Ident(id),
          value: Some(value),
          ..
        }) => {
          if id.sym.eq("className") {
            match value {
              JSXAttrValue::Lit(lit) => {
                self.record_jsx_class_name(Box::new(Expr::Lit(lit.clone())));
                if css_modules {
                  class_name_cx_expr = Some(Box::new(Expr::Call(CallExpr {
                    span: DUMMY_SP,
                    callee: ExprOrSuper::Expr(Box::new(Expr::Ident(quote_ident!("__ALEPH__CX")))),
                    args: vec![ExprOrSpread {
                      spread: None,
                      expr: Box::new(Expr::Lit(lit.clone())),
                    }],
                    type_args: None,
                  })))
                }
              }
              JSXAttrValue::JSXExprContainer(JSXExprContainer { expr, .. }) => {
                if let JSXExpr::Expr(expr) = expr {
                  self.record_jsx_class_name(expr.clone());
                  if css_modules {
                    class_name_cx_expr = Some(Box::new(Expr::Call(CallExpr {
                      span: DUMMY_SP,
                      callee: ExprOrSuper::Expr(Box::new(Expr::Ident(quote_ident!("__ALEPH__CX")))),
                      args: vec![ExprOrSpread {
                        spread: None,
                        expr: expr.clone(),
                      }],
                      type_args: None,
                    })))
                  }
                }
              }
              _ => {}
            };
            class_name_index = Some(index);
            break;
          }
        }
        _ => {}
      };
    }

    if let Some(index) = class_name_index {
      if let Some(expr) = class_name_cx_expr {
        el.attrs[index] = JSXAttrOrSpread::JSXAttr(JSXAttr {
          span: DUMMY_SP,
          name: JSXAttrName::Ident(quote_ident!("className")),
          value: Some(JSXAttrValue::JSXExprContainer(JSXExprContainer {
            span: DUMMY_SP,
            expr: JSXExpr::Expr(expr),
          })),
        });
      }
    }

    // copy from https://github.com/swc-project/swc/blob/master/ecmascript/transforms/src/react/jsx_src.rs
    if self.is_dev {
      let resolver = self.resolver.borrow();
      match self.source.span_to_lines(el.span) {
        Ok(file_lines) => {
          el.attrs.push(JSXAttrOrSpread::JSXAttr(JSXAttr {
            span: DUMMY_SP,
            name: JSXAttrName::Ident(quote_ident!("__source")),
            value: Some(JSXAttrValue::JSXExprContainer(JSXExprContainer {
              span: DUMMY_SP,
              expr: JSXExpr::Expr(Box::new(
                ObjectLit {
                  span: DUMMY_SP,
                  props: vec![
                    PropOrSpread::Prop(Box::new(Prop::KeyValue(KeyValueProp {
                      key: PropName::Ident(quote_ident!("fileName")),
                      value: Box::new(Expr::Lit(Lit::Str(Str {
                        span: DUMMY_SP,
                        value: resolver.specifier.as_str().into(),
                        has_escape: false,
                        kind: Default::default(),
                      }))),
                    }))),
                    PropOrSpread::Prop(Box::new(Prop::KeyValue(KeyValueProp {
                      key: PropName::Ident(quote_ident!("lineNumber")),
                      value: Box::new(Expr::Lit(Lit::Num(Number {
                        span: DUMMY_SP,
                        value: (file_lines.lines[0].line_index + 1) as _,
                      }))),
                    }))),
                  ],
                }
                .into(),
              )),
            })),
          }));
        }
        _ => {}
      };
    }

    el
  }
}

impl Fold for JSXMagicPass2Fold {
  noop_fold_type!();

  fn fold_jsx_element(&mut self, el: JSXElement) -> JSXElement {
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

#[cfg(test)]
mod tests {
  use crate::swc::st;

  #[test]
  fn resolve_jsx_builtin_tags() {
    let source = r#"
      import React from "https://esm.sh/react"
      export default function Index() {
        return (
          <>
            <head>
              <title>Hello World!</title>
              <link rel="stylesheet" href="../style/index.css" />
            </head>
            <a href="/about">About</a>
            <a href="https://github.com">About</a>
            <a href="/about" target="_blank">About</a>
            <script src="ga.js"></script>
            <script>{`
              function gtag() {
                dataLayer.push(arguments)
              }
              window.dataLayer = window.dataLayer || [];
              gtag("js", new Date());
              gtag("config", "G-1234567890");
            `}</script>
          </>
        )
      }
    "#;
    let (code, resolver) = st("/pages/index.tsx", source, false);
    let r = resolver.borrow_mut();
    assert!(code.contains(
      "import __ALEPH__Anchor from \"../-/deno.land/x/aleph@v0.3.0/framework/react/components/Anchor.js\""
    ));
    assert!(code.contains(
      "import __ALEPH__Head from \"../-/deno.land/x/aleph@v0.3.0/framework/react/components/Head.js\""
    ));
    assert!(code.contains(
      "import __ALEPH__StyleLink from \"../-/deno.land/x/aleph@v0.3.0/framework/react/components/StyleLink.js\""
    ));
    assert!(code.contains(
      "import __ALEPH__CustomScript from \"../-/deno.land/x/aleph@v0.3.0/framework/react/components/CustomScript.js\""
    ));
    assert!(code.contains("React.createElement(\"a\","));
    assert!(code.contains("React.createElement(__ALEPH__Anchor,"));
    assert!(code.contains("React.createElement(__ALEPH__Head,"));
    assert!(code.contains("React.createElement(__ALEPH__StyleLink,"));
    assert!(code.contains("React.createElement(__ALEPH__CustomScript,"));
    assert!(code.contains("href: \"/style/index.css\""));
    assert!(code.contains(
      format!(
        "import \"../style/index.css.js#{}@000000\"",
        "/style/index.css"
      )
      .as_str()
    ));
    assert_eq!(
      r.deps
        .iter()
        .map(|g| { g.specifier.as_str() })
        .collect::<Vec<&str>>(),
      vec![
        "/style/index.css",
        "https://deno.land/x/aleph@v0.3.0/framework/react/components/Head.ts",
        "https://deno.land/x/aleph@v0.3.0/framework/react/components/StyleLink.ts",
        "https://deno.land/x/aleph@v0.3.0/framework/react/components/Anchor.ts",
        "https://deno.land/x/aleph@v0.3.0/framework/react/components/CustomScript.ts",
        "https://esm.sh/react"
      ]
    );
  }

  #[test]
  fn resolve_jsx_css_modules() {
    let source = r#"
      import React from "https://esm.sh/react"

      export default function Index() {
        return (
          <>
            <link rel="stylesheet" href="../style/app.module.css" />
            <link rel="stylesheet" href="../style/index.module.css" />
            <h2 className="$title $bold">Hi :)</h2>
            <p className={'$' + 'desc'}>Welcome</p>
            <p className={`bold ${'lg'}`}>Thanks</p>
          </>
        )
      }
    "#;
    let (code, resolver) = st("/pages/index.tsx", source, false);
    let r = resolver.borrow_mut();
    assert!(code.contains(
      "import __ALEPH__StyleLink from \"../-/deno.land/x/aleph@v0.3.0/framework/react/components/StyleLink.js\""
    ));
    assert!(code.contains("React.createElement(__ALEPH__StyleLink,"));
    assert!(code.contains("href: \"/style/index.module.css\""));
    assert!(code.contains(
      format!(
        "import __ALEPH__CSS_MODULES_0 from \"../style/app.module.css.js#{}@000000\"",
        "/style/app.module.css"
      )
      .as_str()
    ));
    assert!(code.contains(
      format!(
        "import __ALEPH__CSS_MODULES_1 from \"../style/index.module.css.js#{}@000001\"",
        "/style/index.module.css"
      )
      .as_str()
    ));
    assert!(code.contains("const __ALEPH__CX = (c)=>typeof c === \"string\" ? c.split(\" \").map((n)=>n.charAt(0) === \"$\" ? __ALEPH__CSS_MODULES_ALL[n.slice(1)] || n : n\n    ).join(\" \") : c"));
    assert!(code.contains("className: __ALEPH__CX(\"$title $bold\")"));
    assert!(code.contains("className: __ALEPH__CX('$' + 'desc')"));
    assert!(code.contains("className: __ALEPH__CX(`bold ${'lg'}`)"));
    assert_eq!(r.jsx_static_class_names.len(), 5);
    assert_eq!(
      r.deps
        .iter()
        .map(|g| { g.specifier.as_str() })
        .collect::<Vec<&str>>(),
      vec![
        "/style/app.module.css",
        "/style/index.module.css",
        "https://deno.land/x/aleph@v0.3.0/framework/react/components/StyleLink.ts",
        "https://esm.sh/react"
      ]
    );
  }

  #[test]
  fn resolve_inlie_style() {
    let source = r#"
      export default function Index() {
        const [color, setColor] = useState('white');

        return (
          <>
            <style>{`
              :root {
                --color: ${color};
              }
            `}</style>
            <style>{`
              h1 {
                font-size: 12px;
              }
            `}</style>
          </>
        )
      }
    "#;
    let (code, resolver) = st("/pages/index.tsx", source, false);
    let r = resolver.borrow_mut();
    assert!(code.contains(
      "import __ALEPH__InlineStyle from \"../-/deno.land/x/aleph@v0.3.0/framework/react/components/InlineStyle.js\""
    ));
    assert!(code.contains("React.createElement(__ALEPH__InlineStyle,"));
    assert!(code.contains("__styleId: \"inline-style-"));
    assert!(r.inline_styles.len() == 2);
  }
}
