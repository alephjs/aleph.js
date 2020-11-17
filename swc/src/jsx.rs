// Copyright 2017-2020 The swc Project Developers. All rights reserved. MIT license.
// Copyright 2020 the Aleph.js authors. All rights reserved. MIT license.

use crate::resolve::Resolver;

use std::cell::RefCell;
use std::rc::Rc;
use swc_common::{FileName, SourceMap, DUMMY_SP};
use swc_ecma_ast::*;
use swc_ecma_utils::quote_ident;
use swc_ecma_visit::{noop_fold_type, Fold};

pub fn aleph_swc_jsx_fold(
    resolver: Rc<RefCell<Resolver>>,
    source: Rc<SourceMap>,
    is_dev: bool,
) -> impl Fold {
    JsxFold {
        resolver,
        source,
        is_dev,
    }
}

/// aleph.js jsx fold for swc, core functions include:
/// - rewrite `Import` path
/// - add `__source` prop in development
struct JsxFold {
    resolver: Rc<RefCell<Resolver>>,
    source: Rc<SourceMap>,
    is_dev: bool,
}

impl Fold for JsxFold {
    noop_fold_type!();

    fn fold_jsx_opening_element(&mut self, mut el: JSXOpeningElement) -> JSXOpeningElement {
        if el.span == DUMMY_SP {
            return el;
        }

        let is_import_el = match el.name {
            JSXElementName::Ident(ref i) => i.sym.chars().as_str().eq("Import"),
            _ => false,
        };

        if is_import_el {
            let mut from_prop_index: i32 = -1;
            let mut from_prop_value = "";

            for (i, attr) in el.attrs.iter().enumerate() {
                match attr {
                    JSXAttrOrSpread::JSXAttr(ref a) => {
                        let name_is_from = match a.name {
                            JSXAttrName::Ident(ref i) => i.sym.chars().as_str().eq("from"),
                            _ => continue,
                        };
                        if name_is_from {
                            match a.value {
                                Some(ref val) => {
                                    match val {
                                        JSXAttrValue::Lit(ref l) => match l {
                                            Lit::Str(ref s) => {
                                                from_prop_index = i as i32;
                                                from_prop_value = s.value.chars().as_str();
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

            if from_prop_index >= 0 {
                let mut r = self.resolver.borrow_mut();
                el.attrs[from_prop_index as usize] = JSXAttrOrSpread::JSXAttr(JSXAttr {
                    span: DUMMY_SP,
                    name: JSXAttrName::Ident(quote_ident!("from")),
                    value: Some(JSXAttrValue::Lit(Lit::Str(Str {
                        span: DUMMY_SP,
                        value: r.resolve(from_prop_value, true).into(),
                        has_escape: false,
                    }))),
                });
            }
        }

        // copy from https://github.com/swc-project/swc/blob/master/ecmascript/transforms/src/react/jsx_src.rs
        if self.is_dev {
            let file_lines = match self.source.span_to_lines(el.span) {
                Ok(v) => v,
                _ => return el,
            };
            let file_name = match file_lines.file.name {
                FileName::Real(ref p) => p.display().to_string(),
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
