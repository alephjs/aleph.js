// Copyright 2020 the Aleph.js authors. All rights reserved. MIT license.

use crate::import_map::ImportMap;

use path_slash::PathBufExt;
use pathdiff::diff_paths;
use rand::distributions::Alphanumeric;
use rand::Rng;
use regex::Regex;
use relative_path::RelativePath;
use std::cell::RefCell;
use std::ops::DerefMut;
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::str::FromStr;
use swc_ecma_ast::*;
use swc_ecma_visit::{noop_fold_type, Fold, FoldWith};
use url::Url;

lazy_static! {
  static ref RE_HTTP: Regex = Regex::new(r"^https?://").unwrap();
  static ref RE_VERSION: Regex =
    Regex::new(r"@\d+(\.\d+){0,2}(\-[a-z0-9]+(\.[a-z0-9]+)?)?$").unwrap();
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DependencyDescriptor {
  /// The text specifier associated with the import/export statement.
  pub specifier: String,
  /// A flag indicating if the import is dynamic or not.
  pub is_dynamic: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Resolver {
  specifier: String,
  import_map: ImportMap,
  bundle_mode: bool,
  has_plugin_resolves: bool,
  specifier_is_remote: bool,
  /// dependency graph
  pub dep_graph: Vec<DependencyDescriptor>,
}

impl Resolver {
  pub fn new(
    specifier: &str,
    import_map: ImportMap,
    bundle_mode: bool,
    has_plugin_resolves: bool,
  ) -> Self {
    let regex_http = Regex::new(r"^https?://").unwrap();
    Resolver {
      specifier: specifier.into(),
      import_map,
      dep_graph: Vec::new(),
      bundle_mode,
      has_plugin_resolves,
      specifier_is_remote: regex_http.is_match(specifier),
    }
  }

  // fix import/export url
  //  - `https://esm.sh/react` -> `/-/esm.sh/react.js`
  //  - `https://esm.sh/react@17.0.1?dev` -> `/-/esm.sh/react@17.0.1_dev.js`
  //  - `http://localhost:8080/mod` -> `/-/http_localhost_8080/mod.js`
  //  - `/components/logo.tsx` -> `/components/logo.tsx`
  //  - `\\components\\logo.tsx` -> `/components/logo.tsx` (windows)
  //  - `@/components/logo.tsx` -> `/components/logo.tsx`
  //  - `../components/logo.tsx` -> `../components/logo.tsx`
  //  - `./button.tsx` -> `./button.tsx`
  //  - `/style/app.css` -> `/style/app.css`
  fn fix_import_url(&self, url: &str) -> String {
    let is_remote = RE_HTTP.is_match(url);
    if !is_remote {
      let slash = PathBuf::from(url).to_slash().unwrap();
      if slash.starts_with("@/") {
        return slash.trim_start_matches("@").into();
      }
      return slash;
    }
    let url = Url::from_str(url).unwrap();
    let path = Path::new(url.path());
    let mut path_buf = path.to_owned();
    let mut ext = ".".to_owned();
    ext.push_str(match path.extension() {
      Some(os_str) => match os_str.to_str() {
        Some(s) => {
          if RE_VERSION.is_match(url.path()) {
            "js"
          } else {
            s
          }
        }
        None => "js",
      },
      None => "js",
    });
    match path.file_name() {
      Some(os_str) => match os_str.to_str() {
        Some(s) => {
          let mut file_name = s.trim_end_matches(ext.as_str()).to_owned();
          match url.query() {
            Some(q) => {
              file_name.push('_');
              file_name.push_str(q);
            }
            _ => {}
          };
          file_name.push_str(ext.as_str());
          path_buf.set_file_name(file_name);
        }
        _ => {}
      },
      _ => {}
    };
    let mut p = "/-/".to_owned();
    if url.scheme() == "http" {
      p.push_str("http_");
    }
    p.push_str(url.host_str().unwrap());
    match url.port() {
      Some(port) => {
        p.push('_');
        p.push_str(port.to_string().as_str());
      }
      _ => {}
    }
    p.push_str(path_buf.to_str().unwrap());
    p
  }

  // resolve import/export url
  pub fn resolve(&mut self, url: &str, is_dynamic: bool) -> String {
    let url = match self.import_map.imports.get(url) {
      Some(url) => url,
      _ => url,
    };
    let is_remote = RE_HTTP.is_match(url);
    let mut resolved_path = if is_remote {
      if self.specifier_is_remote {
        let mut specifier_path = PathBuf::from(self.fix_import_url(self.specifier.as_str()));
        specifier_path.pop();
        diff_paths(self.fix_import_url(url), specifier_path.to_str().unwrap()).unwrap()
      } else {
        let mut specifier_path = PathBuf::from(self.specifier.as_str());
        specifier_path.pop();
        diff_paths(self.fix_import_url(url), specifier_path.to_str().unwrap()).unwrap()
      }
    } else {
      if self.specifier_is_remote {
        let mut new_url = Url::from_str(self.specifier.as_str()).unwrap();
        let mut pathname = PathBuf::from(url);
        let mut specifier_path = PathBuf::from(self.fix_import_url(self.specifier.as_str()));
        specifier_path.pop();
        if !url.starts_with("/") {
          let mut p = PathBuf::from(new_url.path());
          p.pop();
          p.push(url);
          pathname = RelativePath::new(p.to_slash().unwrap().as_str())
            .normalize()
            .to_path(Path::new(""))
        }
        new_url.set_path(pathname.to_slash().unwrap().as_str());
        diff_paths(
          self.fix_import_url(new_url.as_str()),
          specifier_path.to_str().unwrap(),
        )
        .unwrap()
      } else {
        if url.starts_with("@/") {
          let mut specifier_path = PathBuf::from(self.specifier.as_str());
          specifier_path.pop();
          diff_paths(
            url.trim_start_matches("@"),
            specifier_path.to_str().unwrap(),
          )
          .unwrap()
        } else {
          PathBuf::from(url)
        }
      }
    };
    match resolved_path.extension() {
      Some(os_str) => match os_str.to_str() {
        Some(s) => match s {
          "jsx" | "ts" | "tsx" | "mjs" => {
            resolved_path.set_extension("js");
          }
          _ => {}
        },
        None => {}
      },
      None => {}
    };
    if is_remote {
      self.dep_graph.push(DependencyDescriptor {
        specifier: url.into(),
        is_dynamic,
      });
    } else {
      if self.specifier_is_remote {
      } else {
        if url.starts_with("@/") {
          self.dep_graph.push(DependencyDescriptor {
            specifier: url.trim_start_matches("@").into(),
            is_dynamic,
          });
        }
        if url.starts_with("/") {
          self.dep_graph.push(DependencyDescriptor {
            specifier: url.into(),
            is_dynamic,
          });
        } else {
          let mut p = PathBuf::from(self.specifier.as_str());
          p.pop();
          p.push(url);
          let path = RelativePath::new(p.to_slash().unwrap().as_str())
            .normalize()
            .to_path(Path::new(""));
          self.dep_graph.push(DependencyDescriptor {
            specifier: path.to_slash().unwrap(),
            is_dynamic,
          });
        }
      }
    }
    let path = resolved_path.to_slash().unwrap();
    if !path.starts_with("./") && !path.starts_with("../") && !path.starts_with("/") {
      return format!("./{}", path);
    }
    path
  }
}

pub fn aleph_resolve_fold(resolver: Rc<RefCell<Resolver>>) -> impl Fold {
  ResolveFold { resolver }
}

pub struct ResolveFold {
  resolver: Rc<RefCell<Resolver>>,
}

impl Fold for ResolveFold {
  noop_fold_type!();

  // resolve import/export url
  // [/pages/index.tsx]
  // - development mode:
  //   - `import React, {useState} from "https://esm.sh/react"` -> `import React, {useState} from "/_aleph/-/esm.sh/react.js"`
  //   - `import * as React from "https://esm.sh/react"` -> `import * as React from "/_aleph/-/esm.sh/react.js"`
  //   - `import Logo from "../components/logo.tsx"` -> `import Logo from "/_aleph/components/logo.js"`
  //   - `import Logo from "@/components/logo.tsx"` -> `import Logo from "/_aleph/components/logo.js"`
  //   - `import "../style/index.css" -> `import "/_aleph/style/index.css.js"`
  //   - `export React, {useState} from "https://esm.sh/react"` -> `export React, {useState} from * from "/_aleph/-/esm.sh/react.js"`
  //   - `export * from "https://esm.sh/react"` -> `export * from "/_aleph/-/esm.sh/react.js"`
  // - bundling mode:
  //   - `import React, {useState} from "https://esm.sh/react"` -> `const {default: React, useState} = window.__ALEPH_BUNDLING["https://esm.sh/react"]`
  //   - `import * as React from "https://esm.sh/react"` -> `const {__star__: React} = window.__ALEPH_BUNDLING["https://esm.sh/react"]`
  //   - `import Logo from "../components/logo.tsx"` -> `const {default: Logo} = window.__ALEPH_BUNDLING["/components/logo.tsx"]`
  //   - `import Logo from "@/components/logo.tsx"` -> `const {default: Logo} = window.__ALEPH_BUNDLING["/components/logo.tsx"]`
  //   - `import "../style/index.css" -> `__apply_style("CSS_CODE")`
  //   - `export React, {useState} from "https://esm.sh/react"` -> `__export((() => {const {default: React, useState} = window.__ALEPH_BUNDLING["https://esm.sh/react"]; return {React, useState}})())`
  //   - `export * from "https://esm.sh/react"` -> `__export((() => {const {__star__} = window.__ALEPH_BUNDLING["https://esm.sh/react"]; return __star__})())`
  fn fold_module_decl(&mut self, decl: ModuleDecl) -> ModuleDecl {
    match decl {
      ModuleDecl::Import(decl) => {
        let mut r = self.resolver.borrow_mut();
        ModuleDecl::Import(ImportDecl {
          src: Str {
            span: decl.span,
            value: r.resolve(decl.src.value.chars().as_str(), false).into(),
            has_escape: false,
          },
          ..decl
        })
      }
      ModuleDecl::ExportNamed(decl) => {
        let mut r = self.resolver.borrow_mut();
        let url = match decl.src {
          Some(ref src) => src.value.chars().as_str(),
          None => return ModuleDecl::ExportNamed(NamedExport { ..decl }),
        };
        ModuleDecl::ExportNamed(NamedExport {
          src: Some(Str {
            span: decl.span,
            value: r.resolve(url, false).into(),
            has_escape: false,
          }),
          ..decl
        })
      }
      ModuleDecl::ExportAll(decl) => {
        let mut r = self.resolver.borrow_mut();
        ModuleDecl::ExportAll(ExportAll {
          src: Str {
            span: decl.span,
            value: r.resolve(decl.src.value.chars().as_str(), false).into(),
            has_escape: false,
          },
          ..decl
        })
      }
      _ => decl.fold_children_with(self),
    }
  }

  // resolve dynamic import url & sign useDeno hook
  // - `import("https://esm.sh/rect")` -> `import("/_aleph/-/esm.sh/react.js")`
  // - `useDeno(() => {})` -> `useDeno(() => {}, false, "useDeno.RANDOM_ID")`
  fn fold_call_expr(&mut self, mut call: CallExpr) -> CallExpr {
    if is_call_expr_by_name(&call, "import") {
      let mut r = self.resolver.borrow_mut();
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
          value: r.resolve(url, true).into(),
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

#[cfg(test)]
mod tests {
  use super::*;
  use crate::import_map::{ImportHashMap, ImportMap};

  #[test]
  fn test_resolver_fix_import_url() {
    let resolver = Resolver::new(
      ".",
      ImportMap::from_hashmap(ImportHashMap::default()),
      false,
      false,
    );
    assert_eq!(
      resolver.fix_import_url("https://esm.sh/react"),
      "/-/esm.sh/react.js"
    );
    assert_eq!(
      resolver.fix_import_url("https://esm.sh/react@17.0.1?dev"),
      "/-/esm.sh/react@17.0.1_dev.js"
    );
    assert_eq!(
      resolver.fix_import_url("http://localhost:8080/mod"),
      "/-/http_localhost_8080/mod.js"
    );
    assert_eq!(
      resolver.fix_import_url("/components/logo.tsx"),
      "/components/logo.tsx"
    );
    assert_eq!(
      resolver.fix_import_url("@/components/logo.tsx"),
      "/components/logo.tsx"
    );
    assert_eq!(
      resolver.fix_import_url("../components/logo.tsx"),
      "../components/logo.tsx"
    );
    assert_eq!(resolver.fix_import_url("./button.tsx"), "./button.tsx");
    assert_eq!(resolver.fix_import_url("/style/app.css"), "/style/app.css");
  }

  #[test]
  fn test_resolver_resolve() {
    let mut resolver = Resolver::new(
      "/pages/index.tsx",
      ImportMap::from_hashmap(ImportHashMap::default()),
      false,
      false,
    );
    assert_eq!(
      resolver.resolve("https://esm.sh/react", true),
      "../-/esm.sh/react.js"
    );
    assert_eq!(
      resolver.resolve("../components/logo.tsx", true),
      "../components/logo.js"
    );
    assert_eq!(
      resolver.resolve("@/components/logo.tsx", true),
      "../components/logo.js"
    );
    let mut resolver = Resolver::new(
      "https://esm.sh/react-dom",
      ImportMap::from_hashmap(ImportHashMap::default()),
      false,
      false,
    );
    assert_eq!(
      resolver.resolve("https://cdn.esm.sh/react@17.0.1/es2020/react.js", true),
      "../cdn.esm.sh/react@17.0.1/es2020/react.js"
    );
    assert_eq!(resolver.resolve("./react", true), "./react.js");
    assert_eq!(resolver.resolve("/react", true), "./react.js");
    let mut resolver = Resolver::new(
      "https://esm.sh/preact/hooks",
      ImportMap::from_hashmap(ImportHashMap::default()),
      false,
      false,
    );
    assert_eq!(
      resolver.resolve("https://cdn.esm.sh/preact@10.5.7/es2020/preact.js", true),
      "../../cdn.esm.sh/preact@10.5.7/es2020/preact.js"
    );
    assert_eq!(resolver.resolve("../preact", true), "../preact.js");
    assert_eq!(resolver.resolve("/preact", true), "../preact.js");
  }
}
