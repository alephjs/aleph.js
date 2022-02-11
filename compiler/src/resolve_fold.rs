use crate::resolver::Resolver;
use std::{cell::RefCell, rc::Rc};
use swc_common::DUMMY_SP;
use swc_ecma_ast::*;
use swc_ecma_utils::quote_ident;
use swc_ecma_visit::{noop_fold_type, Fold, FoldWith};

pub fn resolve_fold(resolver: Rc<RefCell<Resolver>>) -> impl Fold {
    ResolveFold { resolver }
}

pub struct ResolveFold {
    resolver: Rc<RefCell<Resolver>>,
}

impl Fold for ResolveFold {
    noop_fold_type!();

    // resolve import/export url
    fn fold_module_items(&mut self, module_items: Vec<ModuleItem>) -> Vec<ModuleItem> {
        let mut items = Vec::<ModuleItem>::new();
        let aleph_pkg_uri = self.resolver.borrow().aleph_pkg_uri.clone();
        let jsx_lib = self.resolver.borrow().jsx_lib.clone();
        let jsx_magic_tags = self.resolver.borrow().jsx_magic_tags.clone();

        for name in jsx_magic_tags.clone() {
            let mut resolver = self.resolver.borrow_mut();
            let resolved_url = resolver.resolve(
                format!(
                    "{}/framework/{}/components/{}.ts",
                    aleph_pkg_uri, jsx_lib, name
                )
                .as_str(),
                false,
                false,
            );
            items.push(ModuleItem::ModuleDecl(ModuleDecl::Import(ImportDecl {
                span: DUMMY_SP,
                specifiers: vec![ImportSpecifier::Default(ImportDefaultSpecifier {
                    span: DUMMY_SP,
                    local: quote_ident!("__ALEPH__".to_owned() + name.as_str()),
                })],
                src: new_str(resolved_url),
                type_only: false,
                asserts: None,
            })));
        }

        for item in module_items {
            match item {
                ModuleItem::ModuleDecl(decl) => {
                    let item: ModuleItem = match decl {
                        // match: import React, { useState } from "https://esm.sh/react"
                        ModuleDecl::Import(import_decl) => {
                            if import_decl.type_only {
                                // ingore type import
                                ModuleItem::ModuleDecl(ModuleDecl::Import(import_decl))
                            } else {
                                let mut resolver = self.resolver.borrow_mut();
                                let resolved_url =
                                    resolver.resolve(import_decl.src.value.as_ref(), false, false);
                                ModuleItem::ModuleDecl(ModuleDecl::Import(ImportDecl {
                                    src: new_str(resolved_url),
                                    ..import_decl
                                }))
                            }
                        }
                        // match: export { default as React, useState } from "https://esm.sh/react"
                        // match: export * as React from "https://esm.sh/react"
                        ModuleDecl::ExportNamed(NamedExport {
                            type_only,
                            specifiers,
                            src: Some(src),
                            ..
                        }) => {
                            if type_only {
                                // ingore type export
                                ModuleItem::ModuleDecl(ModuleDecl::ExportNamed(NamedExport {
                                    span: DUMMY_SP,
                                    specifiers,
                                    src: Some(src),
                                    type_only: true,
                                    asserts: None,
                                }))
                            } else {
                                let mut resolver = self.resolver.borrow_mut();
                                let resolved_url =
                                    resolver.resolve(src.value.as_ref(), false, false);
                                ModuleItem::ModuleDecl(ModuleDecl::ExportNamed(NamedExport {
                                    span: DUMMY_SP,
                                    specifiers,
                                    src: Some(new_str(resolved_url)),
                                    type_only: false,
                                    asserts: None,
                                }))
                            }
                        }
                        // match: export * from "https://esm.sh/react"
                        ModuleDecl::ExportAll(ExportAll { src, .. }) => {
                            let mut resolver = self.resolver.borrow_mut();
                            let resolved_url = resolver.resolve(src.value.as_ref(), false, true);
                            ModuleItem::ModuleDecl(ModuleDecl::ExportAll(ExportAll {
                                span: DUMMY_SP,
                                src: new_str(resolved_url.into()),
                                asserts: None,
                            }))
                        }
                        _ => ModuleItem::ModuleDecl(decl),
                    };
                    items.push(item.fold_children_with(self));
                }
                _ => {
                    items.push(item.fold_children_with(self));
                }
            };
        }

        items
    }

    // resolve dynamic import url
    fn fold_call_expr(&mut self, mut call: CallExpr) -> CallExpr {
        if is_call_expr_by_name(&call, "import") {
            let url = match call.args.first() {
                Some(ExprOrSpread { expr, .. }) => match expr.as_ref() {
                    Expr::Lit(lit) => match lit {
                        Lit::Str(s) => s.value.as_ref(),
                        _ => return call,
                    },
                    _ => return call,
                },
                _ => return call,
            };
            let mut resolver = self.resolver.borrow_mut();
            let resolved_url = resolver.resolve(url, true, false);
            call.args = vec![ExprOrSpread {
                spread: None,
                expr: Box::new(Expr::Lit(Lit::Str(new_str(resolved_url)))),
            }];
        }

        call.fold_children_with(self)
    }
}

pub fn is_call_expr_by_name(call: &CallExpr, name: &str) -> bool {
    let callee = match &call.callee {
        Callee::Super(_) => return false,
        Callee::Import(_) => return false,
        Callee::Expr(callee) => callee.as_ref(),
    };

    match callee {
        Expr::Ident(id) => id.sym.as_ref().eq(name),
        _ => false,
    }
}

fn new_str(str: String) -> Str {
    Str {
        span: DUMMY_SP,
        value: str.into(),
        has_escape: false,
        kind: Default::default(),
    }
}
