// Copyright 2017-2020 The swc Project Developers. All rights reserved. MIT license.
// Copyright 2020 the Aleph.js authors. All rights reserved. MIT license.

use crate::aleph::VERSION;
use crate::resolve::Resolver;

use std::{cell::RefCell, rc::Rc};
use swc_common::{FileName, SourceMap, DUMMY_SP};
use swc_ecma_ast::*;
use swc_ecma_utils::quote_ident;
use swc_ecma_visit::{noop_fold_type, Fold};

pub fn aleph_jsx_fold(
    resolver: Rc<RefCell<Resolver>>,
    source: Rc<SourceMap>,
    is_dev: bool,
) -> (impl Fold, impl Fold) {
    (
        AlephJsxFold {
            resolver: resolver.clone(),
            source,
            is_dev,
        },
        AlephJsxBuiltinResolveFold {
            resolver: resolver.clone(),
        },
    )
}

/// aleph.js jsx fold, core functions include:
/// - add `__sourceFile` prop in development mode
/// - resolve `Link` component `href` prop
/// - rename `a` to `Anchor`
/// - rename `head` to `Head`
/// - rename `link` to `Link`
/// - rename `script` to `Script`
/// - rename `style` to `Style`
/// - optimize `img` in producation mode
struct AlephJsxFold {
    resolver: Rc<RefCell<Resolver>>,
    source: Rc<SourceMap>,
    is_dev: bool,
}

impl Fold for AlephJsxFold {
    noop_fold_type!();

    fn fold_jsx_opening_element(&mut self, mut el: JSXOpeningElement) -> JSXOpeningElement {
        if el.span == DUMMY_SP {
            return el;
        }

        let mut resolver = self.resolver.borrow_mut();

        match &el.name {
            JSXElementName::Ident(id) => {
                let name = id.sym.as_ref();
                match name {
                    "a" | "head" | "script" | "style" => {
                        resolver.builtin_jsx_tags.insert(name.into());
                        el.name = JSXElementName::Ident(quote_ident!(rename_builtin_tag(name)));
                    }

                    "img" => {
                        //todo: optimize img
                    }

                    "link" | "Link" => {
                        let mut href_prop_index: i32 = -1;
                        let mut href_prop_value = "";

                        for (i, attr) in el.attrs.iter().enumerate() {
                            match &attr {
                                JSXAttrOrSpread::JSXAttr(a) => {
                                    let is_href = match &a.name {
                                        JSXAttrName::Ident(i) => i.sym.as_ref().eq("href"),
                                        _ => false,
                                    };
                                    if is_href {
                                        match &a.value {
                                            Some(val) => {
                                                match val {
                                                    JSXAttrValue::Lit(l) => match l {
                                                        Lit::Str(s) => {
                                                            href_prop_index = i as i32;
                                                            href_prop_value = s.value.as_ref();
                                                        }
                                                        _ => {}
                                                    },
                                                    _ => {}
                                                };
                                            }
                                            None => {}
                                        };
                                        break;
                                    }
                                }
                                _ => continue,
                            };
                        }

                        if href_prop_index >= 0 {
                            el.attrs[href_prop_index as usize] =
                                JSXAttrOrSpread::JSXAttr(JSXAttr {
                                    span: DUMMY_SP,
                                    name: JSXAttrName::Ident(quote_ident!("href")),
                                    value: Some(JSXAttrValue::Lit(Lit::Str(Str {
                                        span: DUMMY_SP,
                                        value: resolver.resolve(href_prop_value, true).into(),
                                        has_escape: false,
                                    }))),
                                });
                        }

                        if name.eq("link") {
                            resolver.builtin_jsx_tags.insert(name.into());
                            el.name = JSXElementName::Ident(quote_ident!(rename_builtin_tag(name)));
                        }
                    }
                    _ => {}
                }
            }
            _ => {}
        };

        // copy from https://github.com/swc-project/swc/blob/master/ecmascript/transforms/src/react/jsx_src.rs
        if self.is_dev {
            let file_lines = match self.source.span_to_lines(el.span) {
                Ok(v) => v,
                _ => return el,
            };
            let file_name = match &file_lines.file.name {
                FileName::Real(p) => p.display().to_string(),
                _ => unimplemented!("file name for other than real files"),
            };
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
                                        value: file_name.clone().into(),
                                        has_escape: false,
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

        el
    }
}

/// aleph.js jsx builtin fold.
struct AlephJsxBuiltinResolveFold {
    resolver: Rc<RefCell<Resolver>>,
}

impl Fold for AlephJsxBuiltinResolveFold {
    noop_fold_type!();

    fn fold_module_items(&mut self, module_items: Vec<ModuleItem>) -> Vec<ModuleItem> {
        let mut items = Vec::<ModuleItem>::new();
        let mut resolver = self.resolver.borrow_mut();

        for mut name in resolver.builtin_jsx_tags.clone() {
            if name.eq("a") {
                name = "anchor".to_owned()
            }
            items.push(ModuleItem::ModuleDecl(ModuleDecl::Import(ImportDecl {
                span: DUMMY_SP,
                specifiers: vec![ImportSpecifier::Default(ImportDefaultSpecifier {
                    span: DUMMY_SP,
                    local: quote_ident!(rename_builtin_tag(name.as_str())),
                })],
                src: Str {
                    span: DUMMY_SP,
                    value: resolver
                        .resolve(
                            format!(
                                "https://deno.land/x/aleph@v{}/{}.ts",
                                VERSION.as_str(),
                                name
                            )
                            .as_str(),
                            false,
                        )
                        .into(),
                    has_escape: false,
                },
                type_only: false,
                asserts: None,
            })));
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
