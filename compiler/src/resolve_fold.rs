use crate::expr_utils::new_str;
use crate::resolver::Resolver;
use std::{cell::RefCell, rc::Rc};
use swc_common::DUMMY_SP;
use swc_ecma_ast::*;
use swc_ecma_visit::{noop_fold_type, Fold};

pub fn resolve_fold(resolver: Rc<RefCell<Resolver>>, strip_data_export: bool) -> impl Fold {
  ResolveFold {
    resolver,
    strip_data_export,
  }
}

pub struct ResolveFold {
  resolver: Rc<RefCell<Resolver>>,
  strip_data_export: bool,
}

impl Fold for ResolveFold {
  noop_fold_type!();

  // resolve import/export url
  fn fold_module_items(&mut self, module_items: Vec<ModuleItem>) -> Vec<ModuleItem> {
    let mut items = Vec::<ModuleItem>::new();

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
                let resolved_url = resolver.resolve(import_decl.src.value.as_ref(), false);
                ModuleItem::ModuleDecl(ModuleDecl::Import(ImportDecl {
                  src: new_str(&resolved_url),
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
              span,
              asserts,
            }) => {
              if type_only {
                // ingore type export
                ModuleItem::ModuleDecl(ModuleDecl::ExportNamed(NamedExport {
                  span,
                  specifiers,
                  src: Some(src),
                  type_only,
                  asserts,
                }))
              } else {
                let mut resolver = self.resolver.borrow_mut();
                let resolved_url = resolver.resolve(src.value.as_ref(), false);
                ModuleItem::ModuleDecl(ModuleDecl::ExportNamed(NamedExport {
                  span,
                  specifiers,
                  src: Some(new_str(&resolved_url)),
                  type_only,
                  asserts,
                }))
              }
            }
            // match: export * from "https://esm.sh/react"
            ModuleDecl::ExportAll(ExportAll { src, span, asserts }) => {
              let mut resolver = self.resolver.borrow_mut();
              let resolved_url = resolver.resolve(src.value.as_ref(), true);
              ModuleItem::ModuleDecl(ModuleDecl::ExportAll(ExportAll {
                span,
                src: new_str(&resolved_url),
                asserts,
              }))
            }
            ModuleDecl::ExportDecl(ExportDecl {
              decl: Decl::Var(var),
              span,
            }) => {
              let mut data_export_idx = -1;
              let mut has_get_method = false;
              if self.strip_data_export && var.decls.len() > 0 {
                let mut i = 0;
                for decl in &var.decls {
                  if let Pat::Ident(bi) = &decl.name {
                    if let Some(init) = &decl.init {
                      if bi.id.sym.eq("data") {
                        data_export_idx = i;
                        if let Expr::Object(ObjectLit { props, .. }) = init.as_ref() {
                          for prop in props {
                            if let PropOrSpread::Prop(prop) = prop {
                              has_get_method = match prop.as_ref() {
                                Prop::Shorthand(id) => id.sym.eq("get"),
                                Prop::KeyValue(kv) => match &kv.key {
                                  PropName::Str(s) => s.value.eq("get"),
                                  PropName::Ident(id) => id.sym.eq("get"),
                                  _ => false,
                                },
                                Prop::Method(m) => match &m.key {
                                  PropName::Str(s) => s.value.eq("get"),
                                  PropName::Ident(id) => id.sym.eq("get"),
                                  _ => false,
                                },
                                _ => false,
                              };
                              if has_get_method {
                                break;
                              }
                            }
                          }
                        }
                        break;
                      }
                    }
                  }
                  i += 1;
                }
              }
              if data_export_idx != -1 {
                let mut i = -1;
                ModuleItem::ModuleDecl(ModuleDecl::ExportDecl(ExportDecl {
                  span,
                  decl: Decl::Var(VarDecl {
                    decls: var
                      .decls
                      .into_iter()
                      .map(|decl| {
                        i += 1;
                        if data_export_idx == i {
                          VarDeclarator {
                            span: DUMMY_SP,
                            init: Some(Box::new(Expr::Lit(Lit::Bool(Bool {
                              span: DUMMY_SP,
                              value: has_get_method,
                            })))),
                            ..decl
                          }
                        } else {
                          decl
                        }
                      })
                      .collect(),
                    ..var
                  }),
                }))
              } else {
                ModuleItem::ModuleDecl(ModuleDecl::ExportDecl(ExportDecl {
                  span,
                  decl: Decl::Var(var),
                }))
              }
            }
            _ => ModuleItem::ModuleDecl(decl),
          };
          items.push(item);
        }
        _ => {
          items.push(item);
        }
      };
    }

    items
  }
}
