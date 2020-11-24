// Copyright 2017-2020 The swc Project Developers. All rights reserved. MIT license.
// Copyright 2020 the Aleph.js authors. All rights reserved. MIT license.

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
) -> impl Fold {
    AlephJsxFold {
        resolver,
        source,
        is_dev,
    }
}

/// aleph.js jsx fold, core functions include:
/// - add `__sourceFile` prop in development mode
/// - resolve `Link` component `href` prop
/// - rename `a` to `A`
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

        match &el.name {
            JSXElementName::Ident(id) => match id.sym.as_ref() {
                "a" | "head" | "script" | "style" => {
                    let id = uppercase_first_letter(id.sym.as_ref());
                    el.name = JSXElementName::Ident(quote_ident!(id))
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
                        let mut r = self.resolver.borrow_mut();
                        el.attrs[href_prop_index as usize] = JSXAttrOrSpread::JSXAttr(JSXAttr {
                            span: DUMMY_SP,
                            name: JSXAttrName::Ident(quote_ident!("href")),
                            value: Some(JSXAttrValue::Lit(Lit::Str(Str {
                                span: DUMMY_SP,
                                value: r.resolve(href_prop_value, true).into(),
                                has_escape: false,
                            }))),
                        });
                    }

                    let id = uppercase_first_letter(id.sym.as_ref());
                    el.name = JSXElementName::Ident(quote_ident!(id))
                }
                _ => {}
            },
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

fn uppercase_first_letter(s: &str) -> String {
    let mut c = s.chars();
    match c.next() {
        None => String::new(),
        Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
    }
}
