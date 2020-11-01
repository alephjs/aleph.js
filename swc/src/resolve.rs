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
  pub fn new() -> Self {
    ImportMap {
      imports: IndexMap::new(),
      scopes: IndexMap::new(),
    }
  }
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
  import_map: ImportMap,
  has_plugins: bool,
}

impl Resolver {
  pub fn new(import_map: ImportMap, has_plugins: bool) -> Self {
    Resolver {
      import_map,
      has_plugins,
    }
  }
  pub fn resolve(&self, path: &str, importer: &str) -> String {
    "".to_string()
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

  fn fold_module_decl(&mut self, decl: ModuleDecl) -> ModuleDecl {
    // recurse into module
    let decl = decl.fold_children_with(self);

    match decl {
      ModuleDecl::Import(_) => decl,
      ModuleDecl::ExportDecl(_) => decl,
      ModuleDecl::ExportNamed(_) => decl,
      ModuleDecl::ExportDefaultDecl(_) => decl,
      ModuleDecl::ExportDefaultExpr(_) => decl,
      ModuleDecl::ExportAll(_) => decl,
      _ => decl,
    }
  }

  // dynamic import & useDeno
  fn fold_call_expr(&mut self, call: CallExpr) -> CallExpr {
    let call = call.fold_children_with(self);

    if is_call_expr_by_name(&call, "import") {
      call
    } else if is_call_expr_by_name(&call, "useDeno") {
      sign_use_deno_hook(call)
    } else {
      call
    }
  }
}

fn sign_use_deno_hook(mut call: CallExpr) -> CallExpr {
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
  call
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
  return rand::thread_rng()
    .sample_iter(&Alphanumeric)
    .take(9)
    .collect::<String>();
}
