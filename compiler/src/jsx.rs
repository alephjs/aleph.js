// Copyright 2020-2021 postUI Lab. All rights reserved. MIT license.

use crate::aleph::VERSION;
use crate::resolve::{
  create_aleph_pack_var_decl, is_remote_url, DependencyDescriptor, InlineStyle, Resolver,
};

use path_slash::PathBufExt;
use sha1::{Digest, Sha1};
use std::{cell::RefCell, path::PathBuf, rc::Rc};
use swc_common::{SourceMap, Spanned, DUMMY_SP};
use swc_ecma_ast::*;
use swc_ecma_utils::quote_ident;
use swc_ecma_visit::{noop_fold_type, Fold, FoldWith};

pub fn aleph_jsx_fold(
  resolver: Rc<RefCell<Resolver>>,
  source: Rc<SourceMap>,
  is_dev: bool,
) -> (impl Fold, impl Fold) {
  (
    AlephJsxFold {
      resolver: resolver.clone(),
      source,
      inline_style_idx: 0,
      is_dev,
    },
    AlephJsxBuiltinModuleResolveFold { resolver: resolver },
  )
}

/// aleph.js jsx fold, core functions include:
/// - add `__sourceFile` prop in development mode
/// - resolve `a` to `Anchor`
/// - resolve `head` to `Head`
/// - resolve `link` to `Link`
/// - resolve `Link` component `href` prop
/// - resolve `script` to `Script`
/// - resolve `style` to `Style`
/// - optimize `img` in producation mode
struct AlephJsxFold {
  resolver: Rc<RefCell<Resolver>>,
  source: Rc<SourceMap>,
  inline_style_idx: i32,
  is_dev: bool,
}

impl AlephJsxFold {
  fn new_inline_style_ident(&mut self) -> String {
    let resolver = self.resolver.borrow();
    self.inline_style_idx = self.inline_style_idx + 1;
    let mut ident: String = "inline-style-".to_owned();
    let mut hasher = Sha1::new();
    hasher.update(resolver.specifier.clone());
    hasher.update(self.inline_style_idx.to_string());
    ident.push_str(
      base64::encode(hasher.finalize())
        .replace("/", "")
        .replace("+", "")
        .as_str()
        .trim_end_matches('='),
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
          "head" | "script" => {
            let mut resolver = self.resolver.borrow_mut();
            resolver.used_builtin_jsx_tags.insert(name.into());
            el.name = JSXElementName::Ident(quote_ident!(rename_builtin_tag(name)));
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
              resolver.used_builtin_jsx_tags.insert(name.into());
              el.name = JSXElementName::Ident(quote_ident!(rename_builtin_tag(name)));
            }
          }

          "link" | "Link" => {
            let mut should_replace = false;
            let mut rel: Option<String> = None;

            for attr in &el.attrs {
              match &attr {
                JSXAttrOrSpread::JSXAttr(JSXAttr {
                  name: JSXAttrName::Ident(id),
                  value: Some(JSXAttrValue::Lit(Lit::Str(Str { value, .. }))),
                  ..
                }) => {
                  let key = id.sym.as_ref();
                  let value = value.as_ref();
                  if key == "rel" {
                    rel = Some(value.into());
                    if value == "style" || value == "stylesheet" || value == "component" {
                      should_replace = true
                    }
                  }
                }
                _ => {}
              };
            }

            if should_replace {
              let mut href_prop_index: i32 = -1;
              let mut base_prop_index: i32 = -1;
              let mut url_prop_index: i32 = -1;
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
                    "__base" => {
                      base_prop_index = i as i32;
                    }
                    "__url" => {
                      url_prop_index = i as i32;
                    }
                    _ => {}
                  },
                  _ => continue,
                };
              }

              let mut resolver = self.resolver.borrow_mut();
              let (resolved_path, fixed_url) = resolver.resolve(href_prop_value, true, rel);

              if href_prop_index >= 0 {
                el.attrs[href_prop_index as usize] = JSXAttrOrSpread::JSXAttr(JSXAttr {
                  span: DUMMY_SP,
                  name: JSXAttrName::Ident(quote_ident!("href")),
                  value: Some(JSXAttrValue::Lit(Lit::Str(Str {
                    span: DUMMY_SP,
                    value: resolved_path.into(),
                    has_escape: false,
                    kind: Default::default(),
                  }))),
                });
              }

              let mut buf = PathBuf::from(
                resolver
                  .fix_import_url(resolver.specifier.as_str())
                  .as_str(),
              );
              buf.pop();
              let base_attr = JSXAttrOrSpread::JSXAttr(JSXAttr {
                span: DUMMY_SP,
                name: JSXAttrName::Ident(quote_ident!("__base")),
                value: Some(JSXAttrValue::Lit(Lit::Str(Str {
                  span: DUMMY_SP,
                  value: buf.to_slash().unwrap().into(),
                  has_escape: false,
                  kind: Default::default(),
                }))),
              });
              let url_attr = JSXAttrOrSpread::JSXAttr(JSXAttr {
                span: DUMMY_SP,
                name: JSXAttrName::Ident(quote_ident!("__url")),
                value: Some(JSXAttrValue::Lit(Lit::Str(Str {
                  span: DUMMY_SP,
                  value: fixed_url.into(),
                  has_escape: false,
                  kind: Default::default(),
                }))),
              });
              if base_prop_index >= 0 {
                el.attrs[base_prop_index as usize] = base_attr;
              } else {
                el.attrs.push(base_attr);
              }
              if url_prop_index >= 0 {
                el.attrs[url_prop_index as usize] = url_attr;
              } else {
                el.attrs.push(url_attr);
              }

              if name.eq("link") {
                resolver.used_builtin_jsx_tags.insert(name.into());
                el.name = JSXElementName::Ident(quote_ident!(rename_builtin_tag(name)));
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
            resolver.dep_graph.push(DependencyDescriptor {
              specifier: "#".to_owned() + id.as_str(),
              is_dynamic: false,
              rel: None,
            });
            resolver.used_builtin_jsx_tags.insert(name.into());
            el.name = JSXElementName::Ident(quote_ident!(rename_builtin_tag(name)));
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

    // copy from https://github.com/swc-project/swc/blob/master/ecmascript/transforms/src/react/jsx_src.rs
    if self.is_dev {
      let resolver = self.resolver.borrow_mut();
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

    (el, inline_style)
  }
}

impl Fold for AlephJsxFold {
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
                  let raw = self.source.span_to_snippet(quasi.span.clone()).unwrap();
                  qs.push(raw.into());
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

/// aleph.js jsx builtin module resolve fold.
struct AlephJsxBuiltinModuleResolveFold {
  resolver: Rc<RefCell<Resolver>>,
}

impl Fold for AlephJsxBuiltinModuleResolveFold {
  noop_fold_type!();

  fn fold_module_items(&mut self, module_items: Vec<ModuleItem>) -> Vec<ModuleItem> {
    let mut items = Vec::<ModuleItem>::new();
    let mut resolver = self.resolver.borrow_mut();

    for mut name in resolver.used_builtin_jsx_tags.clone() {
      if name.eq("a") {
        name = "anchor".to_owned()
      }
      let id = quote_ident!(rename_builtin_tag(name.as_str()));
      let (resolved_path, fixed_url) = resolver.resolve(
        format!(
          "https://deno.land/x/aleph@v{}/framework/react/{}.ts",
          VERSION.as_str(),
          name
        )
        .as_str(),
        false,
        None,
      );
      if resolver.bundle_mode {
        items.push(ModuleItem::Stmt(Stmt::Decl(Decl::Var(VarDecl {
          span: DUMMY_SP,
          kind: VarDeclKind::Var,
          declare: false,
          decls: vec![create_aleph_pack_var_decl(
            id,
            fixed_url.as_str(),
            Some("default"),
          )],
        }))));
      } else {
        items.push(ModuleItem::ModuleDecl(ModuleDecl::Import(ImportDecl {
          span: DUMMY_SP,
          specifiers: vec![ImportSpecifier::Default(ImportDefaultSpecifier {
            span: DUMMY_SP,
            local: id,
          })],
          src: Str {
            span: DUMMY_SP,
            value: resolved_path.into(),
            has_escape: false,
            kind: Default::default(),
          },
          type_only: false,
          asserts: None,
        })));
      }
    }

    for item in module_items {
      items.push(item)
    }
    items
  }
}

fn rename_builtin_tag(name: &str) -> String {
  let mut c = name.chars();
  let mut name = match c.next() {
    None => String::new(),
    Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
  };
  if name.eq("A") {
    name = "Anchor".into();
  }
  "__ALEPH_".to_owned() + name.as_str()
}
