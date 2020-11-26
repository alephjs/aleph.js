// Copyright 2020 the Aleph.js authors. All rights reserved. MIT license.

use crate::aleph::VERSION;
use crate::import_map::ImportMap;

use indexmap::IndexSet;
use path_slash::PathBufExt;
use pathdiff::diff_paths;
use rand::{distributions::Alphanumeric, Rng};
use regex::Regex;
use relative_path::RelativePath;
use serde::Serialize;
use std::{
  cell::RefCell,
  path::{Path, PathBuf},
  rc::Rc,
  str::FromStr,
};
use swc_common::DUMMY_SP;
use swc_ecma_ast::*;
use swc_ecma_visit::{noop_fold_type, Fold, FoldWith};
use url::Url;

lazy_static! {
  pub static ref HASH_SHORT: usize = 9;
  pub static ref RE_HTTP: Regex = Regex::new(r"^https?://").unwrap();
  pub static ref RE_ENDS_WITH_VERSION: Regex =
    Regex::new(r"@\d+(\.\d+){0,2}(\-[a-z0-9]+(\.[a-z0-9]+)?)?$").unwrap();
  pub static ref RE_REACT_URL: Regex =
    Regex::new(r"^https?://[a-z0-9\-.:]+/react(@[0-9a-z\.\-]+)?(/|\?|$)").unwrap();
  pub static ref RE_REACT_DOM_URL: Regex =
    Regex::new(r"^https?://[a-z0-9\-.:]+/react\-dom(@[0-9a-z\.\-]+)?(/|\?|$)").unwrap();
  pub static ref RE_REACT_SERVER_URL: Regex =
    Regex::new(r"^https?://[a-z0-9\-.:]+/react\-dom(@[0-9a-z\.\-]+)?/server(/|\?|$)").unwrap();
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DependencyDescriptor {
  /// The text specifier associated with the import/export statement.
  pub specifier: String,
  /// A flag indicating if the import is dynamic or not.
  pub is_dynamic: bool,
}

/// A Resolver to resolve aleph.js import/export URL.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Resolver {
  pub specifier: String,
  pub specifier_is_remote: bool,
  import_map: ImportMap,
  bundle_mode: bool,
  react_url: Option<(String, String)>,
  ///  builtin jsx tags like `a`, `head`, etc
  pub builtin_jsx_tags: IndexSet<String>,
  /// dependency graph
  pub dep_graph: Vec<DependencyDescriptor>,
}

impl Resolver {
  pub fn new(
    specifier: &str,
    import_map: ImportMap,
    react_url: Option<(String, String)>,
    bundle_mode: bool,
  ) -> Self {
    Resolver {
      specifier: specifier.into(),
      import_map,
      dep_graph: Vec::new(),
      bundle_mode,
      react_url,
      builtin_jsx_tags: IndexSet::new(),
      specifier_is_remote: RE_HTTP.is_match(specifier),
    }
  }

  /// fix import/export url.
  //  - `https://esm.sh/react` -> `/-/esm.sh/react.js`
  //  - `https://esm.sh/react@17.0.1?target=es2015&dev` -> `/-/esm.sh/react@17.0.1_target=es2015&dev.js`
  //  - `http://localhost:8080/mod` -> `/-/http_localhost_8080/mod.js`
  //  - `/components/logo.tsx` -> `/components/logo.tsx`
  //  - `@/components/logo.tsx` -> `/components/logo.tsx`
  //  - `../components/logo.tsx` -> `../components/logo.tsx`
  //  - `./button.tsx` -> `./button.tsx`
  //  - `/components/foo/./logo.tsx` -> `/components/foo/logo.tsx`
  //  - `/components/foo/../logo.tsx` -> `/components/logo.tsx`
  pub fn fix_import_url(&self, url: &str) -> String {
    let is_remote = RE_HTTP.is_match(url);
    if !is_remote {
      let mut url = url;
      let mut root = Path::new("");
      if url.starts_with("./") {
        url = url.trim_start_matches(".");
        root = Path::new(".");
      } else if url.starts_with("../") {
        url = url.trim_start_matches("..");
        root = Path::new("..");
      } else if url.starts_with("@/") {
        url = url.trim_start_matches("@");
      }
      return RelativePath::new(url)
        .normalize()
        .to_path(root)
        .to_slash()
        .unwrap()
        .to_owned();
    }
    let url = Url::from_str(url).unwrap();
    let path = Path::new(url.path());
    let mut path_buf = path.to_owned();
    let mut ext = ".".to_owned();
    ext.push_str(match path.extension() {
      Some(os_str) => match os_str.to_str() {
        Some(s) => {
          if RE_ENDS_WITH_VERSION.is_match(url.path()) {
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

  /// resolve import/export url.
  // [/pages/index.tsx]
  // - `https://esm.sh/swr` -> `/-/esm.sh/swr.js`
  // - `https://esm.sh/react` -> `/-/esm.sh/react${REACT_VERSION}.js`
  // - `https://deno.land/x/aleph/mod.ts` -> `https://deno.land/x/aleph@v${CURRENT_ALEPH_VERSION}/mod.ts`
  // - `../components/logo.tsx` -> `/components/logo.xxxxxxxxx.js`
  // - `@/components/logo.tsx` -> `import Logo from "/components/logo.xxxxxxxxx.js`
  // - `@/styles/app.css` -> `import Logo from "/styles/app.css.xxxxxxxxx.js`
  pub fn resolve(&mut self, url: &str, is_dynamic: bool) -> String {
    let mut url = self.import_map.resolve(self.specifier.as_str(), url);
    if url.starts_with("https://deno.land/x/aleph/") {
      url = format!(
        "https://deno.land/x/aleph@v{}/{}",
        VERSION.as_str(),
        url.trim_start_matches("https://deno.land/x/aleph/")
      );
    }
    if let Some((react_url, react_dom_url)) = &self.react_url {
      if RE_REACT_SERVER_URL.is_match(url.as_str()) {
        url = react_dom_url.clone() + "/server";
      } else if RE_REACT_DOM_URL.is_match(url.as_str()) {
        url = react_dom_url.clone();
      } else if RE_REACT_URL.is_match(url.as_str()) {
        url = react_url.clone();
      }
    }
    let url = url.as_str();
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
          pathname = RelativePath::new(p.to_str().unwrap())
            .normalize()
            .to_path(Path::new(""))
        }
        new_url.set_path(pathname.to_str().unwrap());
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
          "js" | "jsx" | "ts" | "tsx" | "mjs" => {
            let mut filename = resolved_path
              .file_name()
              .unwrap()
              .to_str()
              .unwrap()
              .trim_end_matches(s)
              .to_owned();
            if !is_remote && !self.specifier_is_remote {
              filename.push_str("x".repeat(*HASH_SHORT).as_str());
              filename.push_str(".js");
            } else {
              filename.push_str("js");
            }
            resolved_path.set_file_name(filename);
          }
          _ => {
            if !is_remote && !self.specifier_is_remote {
              let mut filename = resolved_path
                .file_name()
                .unwrap()
                .to_str()
                .unwrap()
                .to_owned();
              filename.push('.');
              filename.push_str("x".repeat(*HASH_SHORT).as_str());
              filename.push_str(".js");
              resolved_path.set_file_name(filename);
            }
          }
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
        let mut new_url = Url::from_str(self.specifier.as_str()).unwrap();
        let mut pathname = PathBuf::from(url);
        let mut specifier_path = PathBuf::from(self.fix_import_url(self.specifier.as_str()));
        specifier_path.pop();
        if !url.starts_with("/") {
          let mut p = PathBuf::from(new_url.path());
          p.pop();
          p.push(url);
          pathname = RelativePath::new(p.to_str().unwrap())
            .normalize()
            .to_path(Path::new(""))
        }
        new_url.set_path(pathname.to_str().unwrap());
        self.dep_graph.push(DependencyDescriptor {
          specifier: new_url.as_str().into(),
          is_dynamic,
        });
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
          let path = RelativePath::new(p.to_str().unwrap())
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
  AlephResolveFold { resolver }
}

pub struct AlephResolveFold {
  resolver: Rc<RefCell<Resolver>>,
}

impl Fold for AlephResolveFold {
  noop_fold_type!();

  // resolve import/export url
  // [/pages/index.tsx]
  // - development mode:
  //   - `import React, {useState} from "https://esm.sh/react"` -> `import React, {useState} from "/-/esm.sh/react.js"`
  //   - `import * as React from "https://esm.sh/react"` -> `import * as React from "/-/esm.sh/react.js"`
  //   - `import Logo from "../components/logo.tsx"` -> `import Logo from "/components/logo.xxxxxxxxx.js"`
  //   - `import Logo from "@/components/logo.tsx"` -> `import Logo from "/components/logo.xxxxxxxxx.js"`
  //   - `import "../style/index.css" -> `import "/style/index.css.xxxxxxxxx..js"`
  //   - `export React, {useState} from "https://esm.sh/react"` -> `export React, {useState} from * from "/-/esm.sh/react.js"`
  //   - `export * from "https://esm.sh/react"` -> `export * from "/-/esm.sh/react.js"`
  // - bundling mode:
  //   - `import React, {useState} from "https://esm.sh/react"` -> `const {default: React, useState} = window.__ALEPH_PACK["https://esm.sh/react"]`
  //   - `import * as React from "https://esm.sh/react"` -> `const {__star__: React} = window.__ALEPH_PACK["https://esm.sh/react"]`
  //   - `import Logo from "../components/logo.tsx"` -> `const {default: Logo} = window.__ALEPH_PACK["/components/logo.tsx"]`
  //   - `import Logo from "@/components/logo.tsx"` -> `const {default: Logo} = window.__ALEPH_PACK["/components/logo.tsx"]`
  //   - `import "../style/index.css" -> `__apply_style("CSS_CODE")`
  //   - `export React, {useState} from "https://esm.sh/react"` -> `__export((() => {const {default: React, useState} = window.__ALEPH_PACK["https://esm.sh/react"]; return {React, useState}})())`
  //   - `export * from "https://esm.sh/react"` -> `__export((() => {const {__star__} = window.__ALEPH_PACK["https://esm.sh/react"]; return __star__})())`
  fn fold_module_decl(&mut self, decl: ModuleDecl) -> ModuleDecl {
    match decl {
      ModuleDecl::Import(decl) => {
        if decl.type_only {
          ModuleDecl::Import(decl)
        } else {
          let mut resolver = self.resolver.borrow_mut();
          ModuleDecl::Import(ImportDecl {
            src: Str {
              span: DUMMY_SP,
              value: resolver.resolve(decl.src.value.as_ref(), false).into(),
              has_escape: false,
            },
            ..decl
          })
        }
      }
      ModuleDecl::ExportNamed(decl) => {
        if decl.type_only {
          ModuleDecl::ExportNamed(decl)
        } else {
          let url = match &decl.src {
            Some(src) => src.value.as_ref(),
            None => return ModuleDecl::ExportNamed(decl),
          };
          let mut resolver = self.resolver.borrow_mut();
          ModuleDecl::ExportNamed(NamedExport {
            src: Some(Str {
              span: DUMMY_SP,
              value: resolver.resolve(url, false).into(),
              has_escape: false,
            }),
            ..decl
          })
        }
      }
      ModuleDecl::ExportAll(decl) => {
        let mut resolver = self.resolver.borrow_mut();
        ModuleDecl::ExportAll(ExportAll {
          src: Str {
            span: DUMMY_SP,
            value: resolver.resolve(decl.src.value.as_ref(), false).into(),
            has_escape: false,
          },
          ..decl
        })
      }
      _ => decl.fold_children_with(self),
    }
  }

  // resolve dynamic import url & sign useDeno hook
  // - `import("https://esm.sh/rect")` -> `import("/-/esm.sh/react.js")`
  // - `useDeno(() => {})` -> `useDeno(() => {}, false, "useDeno.RANDOM_ID")`
  fn fold_call_expr(&mut self, mut call: CallExpr) -> CallExpr {
    let mut resolver = self.resolver.borrow_mut();
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
      call.args = vec![ExprOrSpread {
        spread: None,
        expr: Box::new(Expr::Lit(Lit::Str(Str {
          span: DUMMY_SP,
          value: resolver.resolve(url, true).into(),
          has_escape: false,
        }))),
      }];
    } else if is_call_expr_by_name(&call, "useDeno") {
      let has_callback = match call.args.first() {
        Some(ExprOrSpread { expr, .. }) => match expr.as_ref() {
          Expr::Fn(_) => true,
          Expr::Arrow(_) => true,
          _ => false,
        },
        _ => false,
      };
      if has_callback {
        let id = new_use_deno_hook_ident();
        if call.args.len() == 1 {
          call.args.push(ExprOrSpread {
            spread: None,
            expr: Box::new(Expr::Lit(Lit::Bool(Bool {
              span: DUMMY_SP,
              value: false,
            }))),
          });
        }
        if call.args.len() > 2 {
          call.args[2] = ExprOrSpread {
            spread: None,
            expr: Box::new(Expr::Lit(Lit::Str(Str {
              span: DUMMY_SP,
              value: id.clone().into(),
              has_escape: false,
            }))),
          };
        } else {
          call.args.push(ExprOrSpread {
            spread: None,
            expr: Box::new(Expr::Lit(Lit::Str(Str {
              span: DUMMY_SP,
              value: id.clone().into(),
              has_escape: false,
            }))),
          });
        }
        resolver.dep_graph.push(DependencyDescriptor {
          specifier: "#".to_owned() + id.clone().as_str(),
          is_dynamic: false,
        });
      }
    }
    call
  }
}

fn is_call_expr_by_name(call: &CallExpr, name: &str) -> bool {
  let callee = match &call.callee {
    ExprOrSuper::Super(_) => return false,
    ExprOrSuper::Expr(callee) => callee.as_ref(),
  };

  match callee {
    Expr::Ident(id) => id.sym.as_ref().eq(name),
    _ => false,
  }
}

fn new_use_deno_hook_ident() -> String {
  let mut ident: String = "useDeno-".to_owned();
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
  use std::collections::HashMap;

  #[test]
  fn test_resolver_fix_import_url() {
    let resolver = Resolver::new(
      "/app.tsx",
      ImportMap::from_hashmap(ImportHashMap::default()),
      None,
      false,
    );
    assert_eq!(
      resolver.fix_import_url("https://esm.sh/react"),
      "/-/esm.sh/react.js"
    );
    assert_eq!(
      resolver.fix_import_url("https://esm.sh/react@17.0.1?target=es2015&dev"),
      "/-/esm.sh/react@17.0.1_target=es2015&dev.js"
    );
    assert_eq!(
      resolver.fix_import_url("http://localhost:8080/mod"),
      "/-/http_localhost_8080/mod.js"
    );
    assert_eq!(
      resolver.fix_import_url("/components/foo/./logo.tsx"),
      "/components/foo/logo.tsx"
    );
    assert_eq!(
      resolver.fix_import_url("/components/foo/../logo.tsx"),
      "/components/logo.tsx"
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
  }

  #[test]
  fn test_resolver_resolve() {
    let mut imports: HashMap<String, Vec<String>> = HashMap::new();
    imports.insert("react".into(), vec!["https://esm.sh/react".into()]);
    imports.insert(
      "react-dom/".into(),
      vec!["https://esm.sh/react-dom/".into()],
    );
    imports.insert(
      "https://deno.land/x/aleph/".into(),
      vec!["http://localhost:9006/".into()],
    );
    let mut resolver = Resolver::new(
      "/pages/index.tsx",
      ImportMap::from_hashmap(ImportHashMap {
        imports,
        scopes: HashMap::new(),
      }),
      Some((
        "https://esm.sh/react@17.0.1".into(),
        "https://esm.sh/react-dom@17.0.1".into(),
      )),
      false,
    );
    assert_eq!(
      resolver.resolve("https://esm.sh/react", false),
      "../-/esm.sh/react@17.0.1.js"
    );
    assert_eq!(
      resolver.resolve("https://esm.sh/react-refresh", false),
      "../-/esm.sh/react-refresh.js"
    );
    assert_eq!(
      resolver.resolve("https://esm.sh/react@16", false),
      "../-/esm.sh/react@17.0.1.js"
    );
    assert_eq!(
      resolver.resolve("https://esm.sh/react-dom", false),
      "../-/esm.sh/react-dom@17.0.1.js"
    );
    assert_eq!(
      resolver.resolve("https://esm.sh/react-dom@16.14.0", false),
      "../-/esm.sh/react-dom@17.0.1.js"
    );
    assert_eq!(
      resolver.resolve("https://esm.sh/react-dom/server", false),
      "../-/esm.sh/react-dom@17.0.1/server.js"
    );
    assert_eq!(
      resolver.resolve("https://esm.sh/react-dom@16.13.1/server", false),
      "../-/esm.sh/react-dom@17.0.1/server.js"
    );
    assert_eq!(
      resolver.resolve("https://deno.land/x/aleph/mod.ts", false),
      "../-/http_localhost_9006/mod.js"
    );
    assert_eq!(
      resolver.resolve("react", false),
      "../-/esm.sh/react@17.0.1.js"
    );
    assert_eq!(
      resolver.resolve("react-dom/server", false),
      "../-/esm.sh/react-dom@17.0.1/server.js"
    );
    assert_eq!(
      resolver.resolve("../components/logo.tsx", false),
      "../components/logo.xxxxxxxxx.js"
    );
    assert_eq!(
      resolver.resolve("@/components/logo.tsx", false),
      "../components/logo.xxxxxxxxx.js"
    );
    assert_eq!(
      resolver.resolve("@/styles/app.css", false),
      "../styles/app.css.xxxxxxxxx.js"
    );

    let mut resolver = Resolver::new(
      "https://esm.sh/react-dom",
      ImportMap::from_hashmap(ImportHashMap::default()),
      None,
      false,
    );
    assert_eq!(
      resolver.resolve("https://cdn.esm.sh/react@17.0.1/es2020/react.js", false),
      "../cdn.esm.sh/react@17.0.1/es2020/react.js"
    );
    assert_eq!(resolver.resolve("./react", false), "./react.js");
    assert_eq!(resolver.resolve("/react", false), "./react.js");

    let mut resolver = Resolver::new(
      "https://esm.sh/preact/hooks",
      ImportMap::from_hashmap(ImportHashMap::default()),
      None,
      false,
    );
    assert_eq!(
      resolver.resolve("https://cdn.esm.sh/preact@10.5.7/es2020/preact.js", false),
      "../../cdn.esm.sh/preact@10.5.7/es2020/preact.js"
    );
    assert_eq!(resolver.resolve("../preact", false), "../preact.js");
    assert_eq!(resolver.resolve("/preact", false), "../preact.js");
  }
}
