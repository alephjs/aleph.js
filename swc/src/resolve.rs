// Copyright 2020 the Aleph.js authors. All rights reserved. MIT license.

use crate::import_map::ImportMap;

use rand::distributions::Alphanumeric;
use rand::Rng;
use regex::Regex;
use std::ops::DerefMut;
use std::rc::Rc;
use swc_ecma_ast::*;
use swc_ecma_visit::{noop_fold_type, Fold, FoldWith};
use swc_ecmascript::dep_graph::DependencyDescriptor;
use url::Url;

#[derive(Debug, Clone)]
pub struct Resolver {
  specifier: String,
  import_map: ImportMap,
  dep_graph: Vec<DependencyDescriptor>,
  bundle_mode: bool,
  has_plugin_resolves: bool,
  regex_http: Regex,
}

impl Resolver {
  pub fn new(
    specifier: &str,
    import_map: ImportMap,
    bundle_mode: bool,
    has_plugin_resolves: bool,
  ) -> Self {
    Resolver {
      specifier: specifier.to_string(),
      import_map,
      dep_graph: Vec::new(),
      bundle_mode,
      has_plugin_resolves,
      regex_http: Regex::new(r"^https?://").unwrap(),
    }
  }

  // fix import/export url
  //  - `https://esm.sh/react` -> `/_alpeh/-/https/esm.sh/react.js`
  //  - `https://esm.sh/react@17.0.1?dev` -> `/_alpeh/-/https/esm.sh/react@17.0.1~dev.js`
  //  - `../components/logo.tsx` -> `/_alpeh/components/logo.js`
  //  - `../style/app.css` -> `/_alpeh/style/app.css.js`
  fn fix_import_url(&self, url: &str) -> String {
    let mut fixed_url: String = url.to_owned();
    let isRemote = self.regex_http.is_match(url);
    fixed_url
  }

  // resolve import/export url
  // - development mode:
  //   - `import React, {useState} from "https://esm.sh/react"` -> `import React, {useState} from "/_alpeh/-/esm.sh/react.js"`
  //   - `import * as React from "https://esm.sh/react"` -> `import * as React from "/_alpeh/-/esm.sh/react.js"`
  //   - `export React, {useState} from "https://esm.sh/react"` -> `export React, {useState} from * from "/_alpeh/-/esm.sh/react.js"`
  //   - `export * from "https://esm.sh/react"` -> `export * from "/_alpeh/-/esm.sh/react.js"`
  // - bundling mode:
  //   - `import React, {useState} from "https://esm.sh/react"` -> `const {default: React, useState} = window.__ALEPH_BUNDLING["https://esm.sh/react"]`
  //   - `import * as React from "https://esm.sh/react"` -> `const {__star__: React} = window.__ALEPH_BUNDLING["https://esm.sh/react"]`
  //   - `export React, {useState} from "https://esm.sh/react"` -> `__export((() => {const {default: React, useState} = window.__ALEPH_BUNDLING["https://esm.sh/react"]; return {React, useState}})())`
  //   - `export * from "https://esm.sh/react"` -> `__export((() => {const {__star__} = window.__ALEPH_BUNDLING["https://esm.sh/react"]; return __star__})())`
  pub fn resolve(&self, url: &str) -> String {
    let mut resolved_url: String = url.to_owned();
    resolved_url
  }
}

pub fn aleph_resolve_fold(resolver: Rc<Resolver>) -> impl Fold {
  ResolveFold { resolver }
}

pub struct ResolveFold {
  resolver: Rc<Resolver>,
}

impl Fold for ResolveFold {
  noop_fold_type!();

  // resolve import/export url
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
  // - `useDeno(() => {})` -> `useDeno(() => {}, false, "useDeno.RANDOM_ID")`
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
        if call.args.len() > 2 {
          call.args[2] = ExprOrSpread {
            spread: None,
            expr: Box::new(Expr::Lit(Lit::Str(Str {
              span: call.span,
              value: new_use_deno_hook_ident().into(),
              has_escape: false,
            }))),
          };
        } else {
          call.args.push(ExprOrSpread {
            spread: None,
            expr: Box::new(Expr::Lit(Lit::Str(Str {
              span: call.span,
              value: new_use_deno_hook_ident().into(),
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

fn new_use_deno_hook_ident() -> String {
  let mut ident: String = "useDeno.".to_owned();
  let rand_id = rand::thread_rng()
    .sample_iter(&Alphanumeric)
    .take(9)
    .collect::<String>();
  ident.push_str(rand_id.as_str());
  return ident;
}
