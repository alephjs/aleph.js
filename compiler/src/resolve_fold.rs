use crate::resolve::{DependencyDescriptor, Resolver};

use sha1::{Digest, Sha1};
use std::{cell::RefCell, rc::Rc};
use swc_common::{SourceMap, Span, DUMMY_SP};
use swc_ecma_ast::*;
use swc_ecma_utils::quote_ident;
use swc_ecma_visit::{noop_fold_type, Fold, FoldWith};

pub fn aleph_resolve_fold(resolver: Rc<RefCell<Resolver>>, source: Rc<SourceMap>) -> impl Fold {
  AlephResolveFold {
    deno_hooks_idx: 0,
    resolver,
    source,
  }
}

pub struct AlephResolveFold {
  deno_hooks_idx: i32,
  resolver: Rc<RefCell<Resolver>>,
  source: Rc<SourceMap>,
}

impl AlephResolveFold {
  fn new_use_deno_hook_ident(&mut self, callback_span: &Span) -> String {
    let resolver = self.resolver.borrow_mut();
    self.deno_hooks_idx = self.deno_hooks_idx + 1;
    let mut ident: String = "useDeno-".to_owned();
    let mut hasher = Sha1::new();
    let callback_code = self.source.span_to_snippet(callback_span.clone()).unwrap();
    hasher.update(resolver.specifier.clone());
    hasher.update(self.deno_hooks_idx.to_string());
    hasher.update(callback_code.clone());
    ident.push_str(
      base64::encode(hasher.finalize())
        .replace("+", "")
        .replace("/", "")
        .replace("=", "")
        .as_str(),
    );
    ident
  }
}

impl Fold for AlephResolveFold {
  noop_fold_type!();

  // resolve import/export url
  // [/pages/index.tsx]
  // - development mode:
  //   - `import React, {useState} from "https://esm.sh/react"` -> `import React, {useState} from "/-/esm.sh/react.js"`
  //   - `import * as React from "https://esm.sh/react"` -> `import * as React from "/-/esm.sh/react.js"`
  //   - `import Logo from "../components/logo.tsx"` -> `import Logo from "/components/logo.{HASH_PLACEHOLDER}.js"`
  //   - `import "../style/index.css" -> `import "/style/index.css.{HASH_PLACEHOLDER}.js"`
  //   - `export React, {useState} from "https://esm.sh/react"` -> `export React, {useState} from * from "/-/esm.sh/react.js"`
  //   - `export * from "https://esm.sh/react"` -> `export * from "/-/esm.sh/react.js"`
  // - bundling mode:
  //   - `import React, {useState} from "https://esm.sh/react"` -> `var React = __ALEPH.pack["https://esm.sh/react"].default, useState = __ALEPH__.PACK["https://esm.sh/react"].useState;`
  //   - `import * as React from "https://esm.sh/react"` -> `var React = __ALEPH.pack["https://esm.sh/react"]`
  //   - `import Logo from "../components/logo.tsx"` -> `var Logo = __ALEPH.pack["/components/logo.tsx"].default`
  //   - `export React, {useState} from "https://esm.sh/react"` -> `__ALEPH.exportFrom("/pages/index.tsx", "https://esm.sh/react", {"default": "React", "useState": "useState'})`
  //   - `export * as React from "https://esm.sh/react"` -> `__ALEPH.exportFrom("/pages/index.tsx", "https://esm.sh/react", {"*": "React"})`
  //   - `export * from "https://esm.sh/react"` -> `__ALEPH.exportFrom("/pages/index.tsx", "https://esm.sh/react", "*")`
  //   - remove `import "../shared/iife.ts"` (push to dep_graph)
  fn fold_module_items(&mut self, module_items: Vec<ModuleItem>) -> Vec<ModuleItem> {
    let mut items = Vec::<ModuleItem>::new();

    for item in module_items {
      match item {
        ModuleItem::ModuleDecl(decl) => {
          let item: ModuleItem = match decl {
            ModuleDecl::Import(import_decl) => {
              if import_decl.type_only {
                ModuleItem::ModuleDecl(ModuleDecl::Import(import_decl))
              } else {
                let mut resolver = self.resolver.borrow_mut();
                let (resolved_path, fixed_url) =
                  resolver.resolve(import_decl.src.value.as_ref(), false, None);
                if resolver.bundle_mode
                  && (is_remote_url(fixed_url.as_str())
                    || resolver.bundled_modules.contains(fixed_url.as_str()))
                {
                  let mut var_decls: Vec<VarDeclarator> = vec![];
                  import_decl.specifiers.into_iter().for_each(|specifier| {
                    match specifier {
                      // import { default as React, useState } from "https://esm.sh/react"
                      ImportSpecifier::Named(ImportNamedSpecifier {
                        local, imported, ..
                      }) => {
                        var_decls.push(create_aleph_pack_var_decl(
                          local.clone(),
                          fixed_url.as_str(),
                          Some(
                            match imported {
                              Some(name) => name,
                              None => local,
                            }
                            .sym
                            .as_ref(),
                          ),
                        ));
                      }
                      // import React from "https://esm.sh/react"
                      ImportSpecifier::Default(ImportDefaultSpecifier { local, .. }) => {
                        var_decls.push(create_aleph_pack_var_decl(
                          local,
                          fixed_url.as_str(),
                          Some("default"),
                        ));
                      }
                      // import * as React from "https://esm.sh/react"
                      ImportSpecifier::Namespace(ImportStarAsSpecifier { local, .. }) => {
                        var_decls.push(create_aleph_pack_var_decl(local, fixed_url.as_str(), None));
                      }
                    }
                  });
                  if var_decls.len() > 0 {
                    // var React = __ALEPH.pack["https://esm.sh/react"].default, useState = __ALEPH.pack["https://esm.sh/react"].useState;
                    ModuleItem::Stmt(Stmt::Decl(Decl::Var(VarDecl {
                      span: DUMMY_SP,
                      kind: VarDeclKind::Var,
                      declare: false,
                      decls: var_decls,
                    })))
                  } else {
                    ModuleItem::Stmt(Stmt::Empty(EmptyStmt { span: DUMMY_SP }))
                  }
                } else {
                  ModuleItem::ModuleDecl(ModuleDecl::Import(ImportDecl {
                    src: new_str(resolved_path),
                    ..import_decl
                  }))
                }
              }
            }
            // export { default as React, useState } from "https://esm.sh/react"
            ModuleDecl::ExportNamed(NamedExport {
              type_only,
              specifiers,
              src: Some(src),
              ..
            }) => {
              if type_only {
                ModuleItem::ModuleDecl(ModuleDecl::ExportNamed(NamedExport {
                  span: DUMMY_SP,
                  specifiers,
                  src: Some(src),
                  type_only: true,
                  asserts: None,
                }))
              } else {
                let mut resolver = self.resolver.borrow_mut();
                let (resolved_path, fixed_url) = resolver.resolve(src.value.as_ref(), false, None);
                if resolver.bundle_mode
                  && (is_remote_url(fixed_url.as_str())
                    || resolver.bundled_modules.contains(fixed_url.as_str()))
                {
                  // __ALEPH.exportFrom("/pages/index.tsx", "https://esm.sh/react", {"default": "React", "useState": "useState'})
                  let call = CallExpr {
                    span: DUMMY_SP,
                    callee: ExprOrSuper::Expr(Box::new(Expr::Ident(quote_ident!("exportFrom")))),
                    args: vec![
                      ExprOrSpread {
                        spread: None,
                        expr: Box::new(Expr::Lit(Lit::Str(new_str(resolver.specifier.clone())))),
                      },
                      ExprOrSpread {
                        spread: None,
                        expr: Box::new(Expr::Lit(Lit::Str(new_str(fixed_url)))),
                      },
                      ExprOrSpread {
                        spread: None,
                        expr: Box::new(Expr::Object(ObjectLit {
                          span: DUMMY_SP,
                          props: specifiers
                            .clone()
                            .into_iter()
                            .map(|specifier| {
                              match specifier {
                                // export Foo from ".."
                                ExportSpecifier::Default(ExportDefaultSpecifier { exported }) => {
                                  PropOrSpread::Prop(Box::new(Prop::KeyValue(KeyValueProp {
                                    key: PropName::Str(new_str("default".into())),
                                    value: Box::new(Expr::Lit(Lit::Str(new_str(
                                      exported.sym.as_ref().into(),
                                    )))),
                                  })))
                                }
                                // export {Foo, bar: Bar} from ".."
                                ExportSpecifier::Named(ExportNamedSpecifier {
                                  orig,
                                  exported,
                                  ..
                                }) => PropOrSpread::Prop(Box::new(Prop::KeyValue(KeyValueProp {
                                  key: PropName::Str(new_str(orig.as_ref().into())),
                                  value: Box::new(Expr::Lit(Lit::Str(new_str(
                                    (match exported {
                                      Some(name) => name,
                                      None => orig,
                                    })
                                    .as_ref()
                                    .into(),
                                  )))),
                                }))),
                                // export * as Foo from ".."
                                ExportSpecifier::Namespace(ExportNamespaceSpecifier {
                                  name,
                                  ..
                                }) => PropOrSpread::Prop(Box::new(Prop::KeyValue(KeyValueProp {
                                  key: PropName::Str(new_str("*".into())),
                                  value: Box::new(Expr::Lit(Lit::Str(new_str(
                                    name.sym.as_ref().into(),
                                  )))),
                                }))),
                              }
                            })
                            .collect::<Vec<PropOrSpread>>(),
                        })),
                      },
                    ],
                    type_args: None,
                  };
                  ModuleItem::Stmt(Stmt::Expr(ExprStmt {
                    span: DUMMY_SP,
                    expr: Box::new(Expr::Member(MemberExpr {
                      span: DUMMY_SP,
                      obj: ExprOrSuper::Expr(Box::new(Expr::Ident(quote_ident!("__ALEPH")))),
                      prop: Box::new(Expr::Call(call)),
                      computed: false,
                    })),
                  }))
                } else {
                  ModuleItem::ModuleDecl(ModuleDecl::ExportNamed(NamedExport {
                    span: DUMMY_SP,
                    specifiers,
                    src: Some(new_str(resolved_path)),
                    type_only: false,
                    asserts: None,
                  }))
                }
              }
            }
            // export * from "https://esm.sh/react"
            ModuleDecl::ExportAll(ExportAll { src, .. }) => {
              let mut resolver = self.resolver.borrow_mut();
              let (resolved_path, fixed_url) = resolver.resolve(src.value.as_ref(), false, None);
              if resolver.bundle_mode
                && (is_remote_url(fixed_url.as_str())
                  || resolver.bundled_modules.contains(fixed_url.as_str()))
              {
                // __ALEPH.exportFrom("/pages/index.tsx", "https://esm.sh/react", "*")
                let call = CallExpr {
                  span: DUMMY_SP,
                  callee: ExprOrSuper::Expr(Box::new(Expr::Ident(quote_ident!("exportFrom")))),
                  args: vec![
                    ExprOrSpread {
                      spread: None,
                      expr: Box::new(Expr::Lit(Lit::Str(new_str(resolver.specifier.clone())))),
                    },
                    ExprOrSpread {
                      spread: None,
                      expr: Box::new(Expr::Lit(Lit::Str(new_str(fixed_url)))),
                    },
                    ExprOrSpread {
                      spread: None,
                      expr: Box::new(Expr::Lit(Lit::Str(new_str("*".into())))),
                    },
                  ],
                  type_args: None,
                };
                ModuleItem::Stmt(Stmt::Expr(ExprStmt {
                  span: DUMMY_SP,
                  expr: Box::new(Expr::Member(MemberExpr {
                    span: DUMMY_SP,
                    obj: ExprOrSuper::Expr(Box::new(Expr::Ident(quote_ident!("__ALEPH")))),
                    prop: Box::new(Expr::Call(call)),
                    computed: false,
                  })),
                }))
              } else {
                ModuleItem::ModuleDecl(ModuleDecl::ExportAll(ExportAll {
                  span: DUMMY_SP,
                  src: new_str(resolved_path.into()),
                  asserts: None,
                }))
              }
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

  fn fold_expr(&mut self, expr: Expr) -> Expr {
    let specifier = self.resolver.borrow().specifier.clone();
    let expr = match expr {
      Expr::Member(MemberExpr {
        span,
        obj,
        prop,
        computed,
      }) => {
        let mut is_import_meta_url = false;
        if let Expr::Ident(id) = prop.as_ref() {
          if id.sym.eq("url") {
            if let ExprOrSuper::Expr(ref expr) = obj {
              if let Expr::MetaProp(MetaPropExpr { meta, prop }) = expr.as_ref() {
                if meta.sym.eq("import") && prop.sym.eq("meta") {
                  is_import_meta_url = true
                }
              }
            }
          }
        }
        if is_import_meta_url {
          Expr::Lit(Lit::Str(new_str(specifier)))
        } else {
          Expr::Member(MemberExpr {
            span,
            obj,
            prop,
            computed,
          })
        }
      }
      _ => expr,
    };

    expr.fold_children_with(self)
  }

  // resolve dynamic import url & sign useDeno hook
  // - `import("https://esm.sh/rect")` -> `import("/-/esm.sh/react.js")`
  // - `import("../components/logo.tsx")` -> `import("/-/esm.sh/react.js")`
  // - `useDeno(() => {})` -> `useDeno(() => {}, false, "useDeno.RANDOM_KEY")`
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
      call.args = vec![ExprOrSpread {
        spread: None,
        expr: Box::new(Expr::Lit(Lit::Str(new_str(
          resolver.resolve(url, true, Some("import".into())).0,
        )))),
      }];
    } else if is_call_expr_by_name(&call, "useDeno") {
      let callback_span = match call.args.first() {
        Some(ExprOrSpread { expr, .. }) => match expr.as_ref() {
          Expr::Fn(FnExpr {
            function: Function { span, .. },
            ..
          }) => Some(span),
          Expr::Arrow(ArrowExpr { span, .. }) => Some(span),
          _ => None,
        },
        _ => None,
      };
      if let Some(span) = callback_span {
        let bundle_mode = self.resolver.borrow().bundle_mode;
        let id = self.new_use_deno_hook_ident(span);
        if bundle_mode {
          call.args[0] = ExprOrSpread {
            spread: None,
            expr: Box::new(Expr::Lit(Lit::Null(Null { span: DUMMY_SP }))),
          };
        }
        if call.args.len() == 1 {
          call.args.push(ExprOrSpread {
            spread: None,
            expr: Box::new(Expr::Lit(Lit::Num(Number {
              span: DUMMY_SP,
              value: 0 as f64,
            }))),
          });
        }
        if call.args.len() > 2 {
          call.args[2] = ExprOrSpread {
            spread: None,
            expr: Box::new(Expr::Lit(Lit::Str(new_str(id.clone())))),
          };
        } else {
          call.args.push(ExprOrSpread {
            spread: None,
            expr: Box::new(Expr::Lit(Lit::Str(new_str(id.clone())))),
          });
        }
        let mut resolver = self.resolver.borrow_mut();
        resolver.dep_graph.push(DependencyDescriptor {
          specifier: "#".to_owned() + id.clone().as_str(),
          is_dynamic: false,
        });
      }
    }

    call.fold_children_with(self)
  }
}

pub fn is_remote_url(url: &str) -> bool {
  return url.starts_with("https://") || url.starts_with("http://");
}

pub fn is_call_expr_by_name(call: &CallExpr, name: &str) -> bool {
  let callee = match &call.callee {
    ExprOrSuper::Super(_) => return false,
    ExprOrSuper::Expr(callee) => callee.as_ref(),
  };

  match callee {
    Expr::Ident(id) => id.sym.as_ref().eq(name),
    _ => false,
  }
}

pub fn create_aleph_pack_var_decl(ident: Ident, url: &str, prop: Option<&str>) -> VarDeclarator {
  let m = Expr::Member(MemberExpr {
    span: DUMMY_SP,
    obj: ExprOrSuper::Expr(Box::new(Expr::Ident(quote_ident!("__ALEPH")))),
    prop: Box::new(Expr::Member(MemberExpr {
      span: DUMMY_SP,
      obj: ExprOrSuper::Expr(Box::new(Expr::Ident(quote_ident!("pack")))),
      prop: Box::new(Expr::Lit(Lit::Str(Str {
        span: DUMMY_SP,
        value: url.into(),
        has_escape: false,
        kind: Default::default(),
      }))),
      computed: true,
    })),
    computed: false,
  });

  match prop {
    Some(prop) => VarDeclarator {
      span: DUMMY_SP,
      name: Pat::Ident(ident),
      init: Some(Box::new(Expr::Member(MemberExpr {
        span: DUMMY_SP,
        obj: ExprOrSuper::Expr(Box::new(m)),
        prop: Box::new(Expr::Ident(quote_ident!(prop))),
        computed: false,
      }))),
      definite: false,
    },
    None => VarDeclarator {
      span: DUMMY_SP,
      name: Pat::Ident(ident),
      init: Some(Box::new(m)),
      definite: false,
    },
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
