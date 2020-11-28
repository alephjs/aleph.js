// Copyright 2017-2020 The swc Project Developers. All rights reserved. MIT license.
// Copyright 2020 the Aleph.js authors. All rights reserved. MIT license.

use crate::aleph::VERSION;
use crate::resolve::{DependencyDescriptor, InlineStyle, Resolver, RE_HTTP};

use rand::{distributions::Alphanumeric, Rng};
use std::{cell::RefCell, path::PathBuf, rc::Rc};
use swc_common::{FileName, SourceMap, Spanned, DUMMY_SP};
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
            is_dev,
        },
        AlephJsxBuiltinModuleResolveFold {
            resolver: resolver.clone(),
        },
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
    is_dev: bool,
}

impl AlephJsxFold {
    fn fold_jsx_opening_element(
        &mut self,
        mut el: JSXOpeningElement,
    ) -> (JSXOpeningElement, Option<(String, String)>) {
        let mut resolver = self.resolver.borrow_mut();
        let mut inline_style: Option<(String, String)> = None;

        match &el.name {
            JSXElementName::Ident(id) => {
                let name = id.sym.as_ref();
                match name {
                    "head" | "script" => {
                        resolver.builtin_jsx_tags.insert(name.into());
                        el.name = JSXElementName::Ident(quote_ident!(rename_builtin_tag(name)));
                    }

                    "a" => {
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
                                    if (key == "href" && RE_HTTP.is_match(value))
                                        || (key == "target" && value == "_blank")
                                    {
                                        should_replace = false
                                    }
                                }
                                _ => {}
                            };
                        }

                        if should_replace {
                            resolver.builtin_jsx_tags.insert(name.into());
                            el.name = JSXElementName::Ident(quote_ident!(rename_builtin_tag(name)));
                        }
                    }

                    "link" | "Link" => {
                        let mut should_replace = false;

                        for attr in &el.attrs {
                            match &attr {
                                JSXAttrOrSpread::JSXAttr(JSXAttr {
                                    name: JSXAttrName::Ident(id),
                                    value: Some(JSXAttrValue::Lit(Lit::Str(Str { value, .. }))),
                                    ..
                                }) => {
                                    let key = id.sym.as_ref();
                                    let value = value.as_ref();
                                    if key == "rel"
                                        && (value == "stylesheet"
                                            || value == "style"
                                            || value == "component")
                                    {
                                        should_replace = true
                                    }
                                }
                                _ => {}
                            };
                        }

                        if should_replace {
                            let mut href_prop_index: i32 = -1;
                            let mut base_url_prop_index: i32 = -1;
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
                                        "__baseUrl" => {
                                            base_url_prop_index = i as i32;
                                        }
                                        _ => {}
                                    },
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
                                            value: resolver.resolve(href_prop_value, true).0.into(),
                                            has_escape: false,
                                        }))),
                                    });
                            }
                            let mut base = PathBuf::from(
                                resolver
                                    .fix_import_url(resolver.specifier.as_str())
                                    .as_str(),
                            );
                            base.pop();

                            let base_url_attr = JSXAttrOrSpread::JSXAttr(JSXAttr {
                                span: DUMMY_SP,
                                name: JSXAttrName::Ident(quote_ident!("__baseUrl")),
                                value: Some(JSXAttrValue::Lit(Lit::Str(Str {
                                    span: DUMMY_SP,
                                    value: base.to_str().unwrap().into(),
                                    has_escape: false,
                                }))),
                            });
                            if base_url_prop_index >= 0 {
                                el.attrs[base_url_prop_index as usize] = base_url_attr;
                            } else {
                                el.attrs.push(base_url_attr);
                            }

                            if name.eq("link") {
                                resolver.builtin_jsx_tags.insert(name.into());
                                el.name =
                                    JSXElementName::Ident(quote_ident!(rename_builtin_tag(name)));
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
                                        type_prop_value =
                                            value.as_ref().trim_start_matches("text/").to_string();
                                    }
                                    _ => {}
                                },
                                _ => continue,
                            };
                        }

                        let id = new_inline_style_ident();
                        let id_attr = JSXAttrOrSpread::JSXAttr(JSXAttr {
                            span: DUMMY_SP,
                            name: JSXAttrName::Ident(quote_ident!("__styleId")),
                            value: Some(JSXAttrValue::Lit(Lit::Str(Str {
                                span: DUMMY_SP,
                                value: id.clone().into(),
                                has_escape: false,
                            }))),
                        });
                        if id_prop_index >= 0 {
                            el.attrs[id_prop_index as usize] = id_attr;
                        } else {
                            el.attrs.push(id_attr);
                        }

                        resolver.dep_graph.push(DependencyDescriptor {
                            specifier: "#".to_owned() + id.as_str(),
                            is_dynamic: false,
                        });

                        resolver.builtin_jsx_tags.insert(name.into());
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
            match self.source.span_to_lines(el.span) {
                Ok(file_lines) => {
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
                                        PropOrSpread::Prop(Box::new(Prop::KeyValue(
                                            KeyValueProp {
                                                key: PropName::Ident(quote_ident!("fileName")),
                                                value: Box::new(Expr::Lit(Lit::Str(Str {
                                                    span: DUMMY_SP,
                                                    value: file_name.clone().into(),
                                                    has_escape: false,
                                                }))),
                                            },
                                        ))),
                                        PropOrSpread::Prop(Box::new(Prop::KeyValue(
                                            KeyValueProp {
                                                key: PropName::Ident(quote_ident!("lineNumber")),
                                                value: Box::new(Expr::Lit(Lit::Num(Number {
                                                    span: DUMMY_SP,
                                                    value: (file_lines.lines[0].line_index + 1)
                                                        as _,
                                                }))),
                                            },
                                        ))),
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
                                    let raw =
                                        self.source.span_to_snippet(quasi.span.clone()).unwrap();
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
                                el.children =
                                    vec![JSXElementChild::JSXExprContainer(JSXExprContainer {
                                        span: DUMMY_SP,
                                        expr: JSXExpr::Expr(Box::new(Expr::Lit(Lit::Str(Str {
                                            span: DUMMY_SP,
                                            value: format!("%%{}-placeholder%%", id).into(),
                                            has_escape: false,
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
                        .0
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

fn new_inline_style_ident() -> String {
    let mut ident: String = "inline-style-".to_owned();
    let rand_id = rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(9)
        .collect::<String>();
    ident.push_str(rand_id.as_str());
    return ident;
}
