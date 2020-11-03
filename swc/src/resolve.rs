// Copyright 2020 the Aleph.js authors. All rights reserved. MIT license.

use indexmap::IndexMap;
use rand::distributions::Alphanumeric;
use rand::Rng;
use serde::Deserialize;
use std::collections::HashMap;
use std::ops::DerefMut;
use std::rc::Rc;
use swc_ecma_ast::*;
use swc_ecma_visit::{noop_fold_type, Fold, FoldWith};

#[derive(Debug, Clone)]
pub struct ImportMap {
  imports: IndexMap<String, String>,
  scopes: IndexMap<String, IndexMap<String, String>>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ImportHashMap {
  #[serde(default)]
  pub imports: HashMap<String, String>,
  #[serde(default)]
  pub scopes: HashMap<String, HashMap<String, String>>,
}

impl Default for ImportHashMap {
  fn default() -> Self {
    ImportHashMap {
      imports: HashMap::new(),
      scopes: HashMap::new(),
    }
  }
}

impl ImportMap {
  pub fn from_hashmap(map: ImportHashMap) -> Self {
    let mut imports: IndexMap<String, String> = IndexMap::new();
    let mut scopes = IndexMap::new();
    for (k, v) in map.imports.iter() {
      imports.insert(k.to_string(), v.to_string());
    }
    for (k, v) in map.scopes.iter() {
      let mut imports_: IndexMap<String, String> = IndexMap::new();
      for (k_, v_) in v.iter() {
        imports_.insert(k_.to_string(), v_.to_string());
      }
      scopes.insert(k.to_string(), imports_);
    }
    ImportMap { imports, scopes }
  }
}

#[derive(Debug, Clone)]
pub struct Resolver {
  specifier: String,
  import_map: ImportMap,
  plugin_resolves: bool,
}

impl Resolver {
  pub fn new(specifier: &str, import_map: ImportMap, plugin_resolves: bool) -> Self {
    Resolver {
      specifier: specifier.to_string(),
      import_map,
      plugin_resolves,
    }
  }
  pub fn resolve(&self, path: &str) -> String {
    "?".to_string()
  }
}

pub fn aleph_resolve_vistor(resolver: Rc<Resolver>) -> impl Fold {
  ResolveVistor { resolver }
}

pub struct ResolveVistor {
  resolver: Rc<Resolver>,
}

impl Fold for ResolveVistor {
  noop_fold_type!();

  // resolve import/export url
  // - development mode:
  //   - `import React from "https://esm.sh/react"` -> `import React from "/_alpeh/-/esm.sh/react.js"`
  //   - `export React, {useState} from "https://esm.sh/react"` -> `export React, {useState} from * from "/_alpeh/-/esm.sh/react.js"`
  //   - `export * from "https://esm.sh/react"` -> `export * from "/_alpeh/-/esm.sh/react.js"`
  // - production mode:
  //   - `import React from "https://esm.sh/react"` -> `import {dep_HASH_default as React} from "/_alpeh/-/deps.js"`
  //   - `export React, {useState} from "https://esm.sh/react"` -> `export {dep_HASH_default as React, dep_HASH_useState as useState} from * from "/_alpeh/-/deps.js"`
  //   - `export * from "https://esm.sh/react"` -> `export * from "/_alpeh/-/esm.sh/react.js"`
  fn fold_module_decl(&mut self, decl: ModuleDecl) -> ModuleDecl {
    match decl {
      ModuleDecl::Import(decl) => ModuleDecl::Import(ImportDecl {
        src: Str {
          span: decl.span,
          value: self
            .resolver
            .resolve(decl.src.value.chars().as_str())
            .into(),
          has_escape: false,
        },
        ..decl
      }),
      ModuleDecl::ExportNamed(decl) => {
        let url = match decl.src {
          Some(ref src) => src.value.chars().as_str(),
          None => return ModuleDecl::ExportNamed(NamedExport { ..decl }),
        };
        ModuleDecl::ExportNamed(NamedExport {
          src: Some(Str {
            span: decl.span,
            value: self.resolver.resolve(url).into(),
            has_escape: false,
          }),
          ..decl
        })
      }
      ModuleDecl::ExportAll(decl) => ModuleDecl::ExportAll(ExportAll {
        src: Str {
          span: decl.span,
          value: self
            .resolver
            .resolve(decl.src.value.chars().as_str())
            .into(),
          has_escape: false,
        },
        ..decl
      }),
      _ => decl.fold_children_with(self),
    }
  }

  // resolve dynamic import url & sign useDeno hook
  // - `import("https://esm.sh/rect")` -> `import("/_aleph/-/esm.sh/react.js")`
  // - `useDeno(() => {})` -> `useDeno(()=>{}, false, void 0, "useDeno.RANDOM_ID")`
  fn fold_call_expr(&mut self, mut call: CallExpr) -> CallExpr {
    if is_call_expr_by_name(&call, "import") {
      let url = match call.args.first_mut() {
        Some(&mut ExprOrSpread { ref mut expr, .. }) => match expr.deref_mut() {
          Expr::Lit(lit) => match lit {
            Lit::Str(s) => s.value.chars().as_str(),
            _ => return call,
          },
          _ => return call,
        },
        _ => return call,
      };
      call.args = vec![ExprOrSpread {
        spread: None,
        expr: Box::new(Expr::Lit(Lit::Str(Str {
          span: call.span,
          value: self.resolver.resolve(url).into(),
          has_escape: false,
        }))),
      }];
    } else if is_call_expr_by_name(&call, "useDeno") {
      let has_callback = match call.args.first_mut() {
        Some(&mut ExprOrSpread { ref mut expr, .. }) => match expr.deref_mut() {
          Expr::Fn(_) => true,
          Expr::Arrow(_) => true,
          _ => false,
        },
        _ => false,
      };
      if has_callback {
        if call.args.len() == 1 {
          call.args.push(ExprOrSpread {
            spread: None,
            expr: Box::new(Expr::Lit(Lit::Bool(Bool {
              span: call.span,
              value: false,
            }))),
          });
        }
        if call.args.len() == 2 {
          call.args.push(ExprOrSpread {
            spread: None,
            expr: Box::new(Expr::Unary(UnaryExpr {
              span: call.span,
              op: op!("void"),
              arg: Box::new(Expr::Lit(Lit::Num(Number {
                span: call.span,
                value: 0.0,
              }))),
            })),
          });
        }
        if call.args.len() > 3 {
          call.args[3] = ExprOrSpread {
            spread: None,
            expr: Box::new(Expr::Lit(Lit::Str(Str {
              span: call.span,
              value: gen_use_deno_hook_ident().into(),
              has_escape: false,
            }))),
          };
        } else {
          call.args.push(ExprOrSpread {
            spread: None,
            expr: Box::new(Expr::Lit(Lit::Str(Str {
              span: call.span,
              value: gen_use_deno_hook_ident().into(),
              has_escape: false,
            }))),
          });
        }
      }
    }
    call
  }
}

fn is_call_expr_by_name(call: &CallExpr, name: &str) -> bool {
  let callee = match &call.callee {
    ExprOrSuper::Super(_) => return false,
    ExprOrSuper::Expr(callee) => &**callee,
  };

  match callee {
    Expr::Ident(id) => id.sym.chars().as_str().eq(name),
    _ => false,
  }
}

fn gen_use_deno_hook_ident() -> String {
  let mut ident: String = "useDeno.".to_owned();
  let rand_id = rand::thread_rng()
    .sample_iter(&Alphanumeric)
    .take(9)
    .collect::<String>();
  ident.push_str(rand_id.as_str());
  return ident;
}
