// Copyright 2020-2021 postUI Lab. All rights reserved. MIT license.

use crate::aleph::VERSION;
use crate::import_map::{ImportHashMap, ImportMap};

use indexmap::IndexSet;
use path_slash::PathBufExt;
use pathdiff::diff_paths;
use regex::Regex;
use relative_path::RelativePath;
use serde::Serialize;
use sha1::{Digest, Sha1};
use std::{
  cell::RefCell,
  collections::HashMap,
  path::{Path, PathBuf},
  rc::Rc,
  str::FromStr,
};
use swc_common::DUMMY_SP;
use swc_ecma_ast::*;
use swc_ecma_utils::quote_ident;
use swc_ecma_visit::{noop_fold_type, Fold, FoldWith};
use url::Url;

lazy_static! {
  pub static ref HASH_PLACEHOLDER: String = "x".repeat(9);
  pub static ref RE_ENDS_WITH_VERSION: Regex = Regex::new(
    r"@\d+(\.\d+){0,2}(\-[a-z0-9]+(\.[a-z0-9]+)?)?$"
  )
  .unwrap();
  pub static ref RE_REACT_URL: Regex = Regex::new(
    r"^https?://(esm.sh/|cdn.esm.sh/v\d+/|esm.x-static.io/v\d+/|jspm.dev/|cdn.skypack.dev/|jspm.dev/npm:|esm.run/)react(\-dom)?(@[\^|~]{0,1}[0-9a-z\.\-]+)?([/|\?].*)?$"
  )
  .unwrap();
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DependencyDescriptor {
  pub specifier: String,
  pub is_dynamic: bool,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub rel: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InlineStyle {
  pub r#type: String,
  pub quasis: Vec<String>,
  pub exprs: Vec<String>,
}

/// A Resolver to resolve aleph.js import/export URL.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Resolver {
  /// The text specifier associated with the import/export statement.
  pub specifier: String,
  /// A flag indicating if the specifier is remote url or not.
  pub specifier_is_remote: bool,
  ///  builtin jsx tags like `a`, `link`, `head`, etc
  pub builtin_jsx_tags: IndexSet<String>,
  /// dependency graph
  pub dep_graph: Vec<DependencyDescriptor>,
  /// inline styles
  pub inline_styles: HashMap<String, InlineStyle>,
  /// bundle mode
  pub bundle_mode: bool,
  /// bundled modules
  pub bundled_modules: IndexSet<String>,
  import_map: ImportMap,
  react_version: Option<String>,
}

impl Resolver {
  pub fn new(
    specifier: &str,
    import_map: ImportHashMap,
    react_version: Option<String>,
    bundle_mode: bool,
    bundled_modules: Vec<String>,
  ) -> Self {
    let mut set = IndexSet::<String>::new();
    for url in bundled_modules {
      set.insert(url);
    }
    Resolver {
      specifier: specifier.into(),
      specifier_is_remote: is_remote_url(specifier),
      builtin_jsx_tags: IndexSet::new(),
      dep_graph: Vec::new(),
      inline_styles: HashMap::new(),
      import_map: ImportMap::from_hashmap(import_map),
      react_version,
      bundle_mode,
      bundled_modules: set,
    }
  }

  /// fix import/export url.
  //  - `https://esm.sh/react` -> `/-/esm.sh/react.js`
  //  - `https://esm.sh/react@17.0.1?target=es2015&dev` -> `/-/esm.sh/react@17.0.1_target=es2015&dev.js`
  //  - `http://localhost:8080/mod` -> `/-/http_localhost_8080/mod.js`
  //  - `/components/logo.tsx` -> `/components/logo.tsx`
  //  - `@/components/logo.tsx` -> `/components/logo.tsx`
  //  - `~/components/logo.tsx` -> `/components/logo.tsx`
  //  - `../components/logo.tsx` -> `../components/logo.tsx`
  //  - `./button.tsx` -> `./button.tsx`
  //  - `/components/foo/./logo.tsx` -> `/components/foo/logo.tsx`
  //  - `/components/foo/../logo.tsx` -> `/components/logo.tsx`
  pub fn fix_import_url(&self, url: &str) -> String {
    let is_remote = is_remote_url(url);
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
      } else if url.starts_with("~/") {
        url = url.trim_start_matches("~");
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
  // - `https://esm.sh/react` -> `/-/esm.sh/react@${REACT_VERSION}.js`
  // - `https://deno.land/x/aleph/mod.ts` -> `/-/deno.land/x/aleph@v${CURRENT_ALEPH_VERSION}/mod.ts`
  // - `../components/logo.tsx` -> `/components/logo.{HASH}.js`
  // - `../styles/app.css` -> `/styles/app.css.{HASH}.js`
  // - `@/components/logo.tsx` -> `/components/logo.{HASH}.js`
  // - `~/components/logo.tsx` -> `/components/logo.{HASH}.js`
  pub fn resolve(&mut self, url: &str, is_dynamic: bool, rel: Option<String>) -> (String, String) {
    // apply import map
    let url = self.import_map.resolve(self.specifier.as_str(), url);
    let mut fixed_url: String = if is_remote_url(url.as_str()) {
      url.into()
    } else {
      if self.specifier_is_remote {
        let mut new_url = Url::from_str(self.specifier.as_str()).unwrap();
        if url.starts_with("/") {
          new_url.set_path(url.as_str());
        } else {
          let mut buf = PathBuf::from(new_url.path());
          buf.pop();
          buf.push(url);
          let path = "/".to_owned()
            + RelativePath::new(buf.to_slash().unwrap().as_str())
              .normalize()
              .as_str();
          new_url.set_path(path.as_str());
        }
        new_url.as_str().into()
      } else {
        if url.starts_with("/") {
          url.into()
        } else if url.starts_with("@/") {
          url.trim_start_matches("@").into()
        } else if url.starts_with("~/") {
          url.trim_start_matches("~").into()
        } else {
          let mut buf = PathBuf::from(self.specifier.as_str());
          buf.pop();
          buf.push(url);
          "/".to_owned()
            + RelativePath::new(buf.to_slash().unwrap().as_str())
              .normalize()
              .as_str()
        }
      }
    };
    // fix deno.land/x/aleph url
    if fixed_url.starts_with("https://deno.land/x/aleph/") {
      fixed_url = format!(
        "https://deno.land/x/aleph@v{}/{}",
        VERSION.as_str(),
        fixed_url.trim_start_matches("https://deno.land/x/aleph/")
      );
    }
    // fix react/react-dom url
    if let Some(version) = &self.react_version {
      if RE_REACT_URL.is_match(fixed_url.as_str()) {
        let caps = RE_REACT_URL.captures(fixed_url.as_str()).unwrap();
        let mut host = caps.get(1).map_or("", |m| m.as_str());
        let non_esm_sh_cdn = !host.starts_with("esm.sh/")
          && !host.starts_with("cdn.esm.sh/")
          && !host.starts_with("esm.x-static.io/");
        if non_esm_sh_cdn {
          host = "esm.sh/"
        }
        let pkg = caps.get(2).map_or("", |m| m.as_str());
        let ver = caps.get(3).map_or("", |m| m.as_str());
        let path = caps.get(4).map_or("", |m| m.as_str());
        if non_esm_sh_cdn || ver != version {
          fixed_url = format!("https://{}react{}@{}{}", host, pkg, version, path);
        }
      }
    }
    let is_remote = is_remote_url(fixed_url.as_str());
    let mut resolved_path = if is_remote {
      if self.specifier_is_remote {
        let mut buf = PathBuf::from(self.fix_import_url(self.specifier.as_str()));
        buf.pop();
        diff_paths(
          self.fix_import_url(fixed_url.as_str()),
          buf.to_slash().unwrap(),
        )
        .unwrap()
      } else {
        let mut buf = PathBuf::from(self.specifier.as_str());
        buf.pop();
        diff_paths(
          self.fix_import_url(fixed_url.as_str()),
          buf.to_slash().unwrap(),
        )
        .unwrap()
      }
    } else {
      if self.specifier_is_remote {
        let mut new_url = Url::from_str(self.specifier.as_str()).unwrap();
        if fixed_url.starts_with("/") {
          new_url.set_path(fixed_url.as_str());
        } else {
          let mut buf = PathBuf::from(new_url.path());
          buf.pop();
          buf.push(fixed_url.as_str());
          let path = "/".to_owned()
            + RelativePath::new(buf.to_slash().unwrap().as_str())
              .normalize()
              .as_str();
          new_url.set_path(path.as_str());
        }
        let mut buf = PathBuf::from(self.fix_import_url(self.specifier.as_str()));
        buf.pop();
        diff_paths(
          self.fix_import_url(new_url.as_str()),
          buf.to_slash().unwrap(),
        )
        .unwrap()
      } else {
        if fixed_url.starts_with("/") {
          let mut buf = PathBuf::from(self.specifier.as_str());
          buf.pop();
          diff_paths(fixed_url.clone(), buf.to_slash().unwrap()).unwrap()
        } else {
          PathBuf::from(fixed_url.clone())
        }
      }
    };
    // fix extension & add hash placeholder
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
              filename.push_str(HASH_PLACEHOLDER.as_str());
              filename.push('.');
            }
            filename.push_str("js");
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
              filename.push_str(HASH_PLACEHOLDER.as_str());
              filename.push_str(".js");
              resolved_path.set_file_name(filename);
            }
          }
        },
        None => {}
      },
      None => {}
    };
    self.dep_graph.push(DependencyDescriptor {
      specifier: fixed_url.clone(),
      is_dynamic,
      rel,
    });
    let path = resolved_path.to_slash().unwrap();
    if !path.starts_with("./") && !path.starts_with("../") && !path.starts_with("/") {
      return (format!("./{}", path), fixed_url);
    }
    (path, fixed_url)
  }
}

pub fn aleph_resolve_fold(resolver: Rc<RefCell<Resolver>>) -> impl Fold {
  AlephResolveFold {
    deno_hooks_idx: 0,
    resolver,
  }
}

pub struct AlephResolveFold {
  deno_hooks_idx: i32,
  resolver: Rc<RefCell<Resolver>>,
}

impl AlephResolveFold {
  fn new_use_deno_hook_ident(&mut self) -> String {
    let resolver = self.resolver.borrow_mut();
    self.deno_hooks_idx = self.deno_hooks_idx + 1;
    let mut ident: String = "useDeno-".to_owned();
    let mut hasher = Sha1::new();
    hasher.update(resolver.specifier.clone());
    hasher.update(self.deno_hooks_idx.to_string());
    ident.push_str(base64::encode(hasher.finalize()).as_str());
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
  //   - `import Logo from "@/components/logo.tsx"` -> `import Logo from "/components/logo.{HASH_PLACEHOLDER}.js"`
  //   - `import "../style/index.css" -> `import "/style/index.css.{HASH_PLACEHOLDER}.js"`
  //   - `export React, {useState} from "https://esm.sh/react"` -> `export React, {useState} from * from "/-/esm.sh/react.js"`
  //   - `export * from "https://esm.sh/react"` -> `export * from "/-/esm.sh/react.js"`
  // - bundling mode:
  //   - `import React, {useState} from "https://esm.sh/react"` -> `var React = __ALEPH.pack["https://esm.sh/react"].default, useState = __ALEPH__.PACK["https://esm.sh/react"].useState;`
  //   - `import * as React from "https://esm.sh/react"` -> `var React = __ALEPH.pack["https://esm.sh/react"]`
  //   - `import Logo from "../components/logo.tsx"` -> `var Logo = __ALEPH.pack["/components/logo.tsx"].default`
  //   - `import Logo from "@/components/logo.tsx"` -> `var Logo = __ALEPH.pack["/components/logo.tsx"].default`
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
                  import_decl
                    .specifiers
                    .into_iter()
                    .for_each(|specifier| match specifier {
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
                    src: new_js_str(resolved_path),
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
                        expr: Box::new(Expr::Lit(Lit::Str(new_js_str(resolver.specifier.clone())))),
                      },
                      ExprOrSpread {
                        spread: None,
                        expr: Box::new(Expr::Lit(Lit::Str(new_js_str(fixed_url)))),
                      },
                      ExprOrSpread {
                        spread: None,
                        expr: Box::new(Expr::Object(ObjectLit {
                          span: DUMMY_SP,
                          props: specifiers
                            .clone()
                            .into_iter()
                            .map(|specifier| match specifier {
                              // export Foo from ".."
                              ExportSpecifier::Default(ExportDefaultSpecifier { exported }) => {
                                PropOrSpread::Prop(Box::new(Prop::KeyValue(KeyValueProp {
                                  key: PropName::Str(new_js_str("default".into())),
                                  value: Box::new(Expr::Lit(Lit::Str(new_js_str(
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
                                key: PropName::Str(new_js_str(orig.as_ref().into())),
                                value: Box::new(Expr::Lit(Lit::Str(new_js_str(
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
                                name, ..
                              }) => PropOrSpread::Prop(Box::new(Prop::KeyValue(KeyValueProp {
                                key: PropName::Str(new_js_str("*".into())),
                                value: Box::new(Expr::Lit(Lit::Str(new_js_str(
                                  name.sym.as_ref().into(),
                                )))),
                              }))),
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
                    src: Some(new_js_str(resolved_path)),
                    type_only: false,
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
                      expr: Box::new(Expr::Lit(Lit::Str(new_js_str(resolver.specifier.clone())))),
                    },
                    ExprOrSpread {
                      spread: None,
                      expr: Box::new(Expr::Lit(Lit::Str(new_js_str(fixed_url)))),
                    },
                    ExprOrSpread {
                      spread: None,
                      expr: Box::new(Expr::Lit(Lit::Str(new_js_str("*".into())))),
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
                  src: new_js_str(resolved_path.into()),
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

  // resolve dynamic import url & sign useDeno hook
  // - `import("https://esm.sh/rect")` -> `import("/-/esm.sh/react.js")`
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
        expr: Box::new(Expr::Lit(Lit::Str(new_js_str(
          resolver.resolve(url, true, Some("import".into())).0,
        )))),
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
        let id = self.new_use_deno_hook_ident();
        if call.args.len() > 1 {
          call.args[1] = ExprOrSpread {
            spread: None,
            expr: Box::new(Expr::Lit(Lit::Str(new_js_str(id.clone())))),
          };
        } else {
          call.args.push(ExprOrSpread {
            spread: None,
            expr: Box::new(Expr::Lit(Lit::Str(new_js_str(id.clone())))),
          });
        }
        let mut resolver = self.resolver.borrow_mut();
        resolver.dep_graph.push(DependencyDescriptor {
          specifier: "#".to_owned() + id.clone().as_str(),
          is_dynamic: false,
          rel: None,
        });
      }
    }
    call
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

fn new_js_str(str: String) -> Str {
  Str {
    span: DUMMY_SP,
    value: str.into(),
    has_escape: false,
    kind: Default::default(),
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::import_map::ImportHashMap;
  use std::collections::HashMap;

  #[test]
  fn test_resolver_fix_import_url() {
    let resolver = Resolver::new("/app.tsx", ImportHashMap::default(), None, false, vec![]);
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
      resolver.fix_import_url("/components/../foo/logo.tsx"),
      "/foo/logo.tsx"
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
  fn test_resolve_local() {
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
      ImportHashMap {
        imports,
        scopes: HashMap::new(),
      },
      Some("17.0.1".into()),
      false,
      vec![],
    );
    assert_eq!(
      resolver.resolve("https://esm.sh/react", false, None),
      (
        "../-/esm.sh/react@17.0.1.js".into(),
        "https://esm.sh/react@17.0.1".into()
      )
    );
    assert_eq!(
      resolver.resolve("https://esm.sh/react-refresh", false, None),
      (
        "../-/esm.sh/react-refresh.js".into(),
        "https://esm.sh/react-refresh".into()
      )
    );
    assert_eq!(
      resolver.resolve(
        "https://deno.land/x/aleph/framework/react/link.ts",
        false,
        None
      ),
      (
        "../-/http_localhost_9006/framework/react/link.js".into(),
        "http://localhost:9006/framework/react/link.ts".into()
      )
    );
    assert_eq!(
      resolver.resolve("https://esm.sh/react@16", false, None),
      (
        "../-/esm.sh/react@17.0.1.js".into(),
        "https://esm.sh/react@17.0.1".into()
      )
    );
    assert_eq!(
      resolver.resolve("https://esm.sh/react-dom", false, None),
      (
        "../-/esm.sh/react-dom@17.0.1.js".into(),
        "https://esm.sh/react-dom@17.0.1".into()
      )
    );
    assert_eq!(
      resolver.resolve("https://esm.sh/react-dom@16.14.0", false, None),
      (
        "../-/esm.sh/react-dom@17.0.1.js".into(),
        "https://esm.sh/react-dom@17.0.1".into()
      )
    );
    assert_eq!(
      resolver.resolve("https://esm.sh/react-dom/server", false, None),
      (
        "../-/esm.sh/react-dom@17.0.1/server.js".into(),
        "https://esm.sh/react-dom@17.0.1/server".into()
      )
    );
    assert_eq!(
      resolver.resolve("https://esm.sh/react-dom@16.13.1/server", false, None),
      (
        "../-/esm.sh/react-dom@17.0.1/server.js".into(),
        "https://esm.sh/react-dom@17.0.1/server".into()
      )
    );
    assert_eq!(
      resolver.resolve("react-dom/server", false, None),
      (
        "../-/esm.sh/react-dom@17.0.1/server.js".into(),
        "https://esm.sh/react-dom@17.0.1/server".into()
      )
    );
    assert_eq!(
      resolver.resolve("react", false, None),
      (
        "../-/esm.sh/react@17.0.1.js".into(),
        "https://esm.sh/react@17.0.1".into()
      )
    );
    assert_eq!(
      resolver.resolve("https://deno.land/x/aleph/mod.ts", false, None),
      (
        "../-/http_localhost_9006/mod.js".into(),
        "http://localhost:9006/mod.ts".into()
      )
    );
    assert_eq!(
      resolver.resolve("../components/logo.tsx", false, None),
      (
        format!("../components/logo.{}.js", HASH_PLACEHOLDER.as_str()),
        "/components/logo.tsx".into()
      )
    );
    assert_eq!(
      resolver.resolve("../styles/app.css", false, None),
      (
        format!("../styles/app.css.{}.js", HASH_PLACEHOLDER.as_str()),
        "/styles/app.css".into()
      )
    );
    assert_eq!(
      resolver.resolve("@/components/logo.tsx", false, None),
      (
        format!("../components/logo.{}.js", HASH_PLACEHOLDER.as_str()),
        "/components/logo.tsx".into()
      )
    );
    assert_eq!(
      resolver.resolve("~/components/logo.tsx", false, None),
      (
        format!("../components/logo.{}.js", HASH_PLACEHOLDER.as_str()),
        "/components/logo.tsx".into()
      )
    );
  }

  #[test]
  fn test_resolve_remote_1() {
    let mut resolver = Resolver::new(
      "https://esm.sh/react-dom",
      ImportHashMap::default(),
      Some("17.0.1".into()),
      false,
      vec![],
    );
    assert_eq!(
      resolver.resolve(
        "https://cdn.esm.sh/react@17.0.1/es2020/react.js",
        false,
        None
      ),
      (
        "../cdn.esm.sh/react@17.0.1/es2020/react.js".into(),
        "https://cdn.esm.sh/react@17.0.1/es2020/react.js".into()
      )
    );
    assert_eq!(
      resolver.resolve("./react", false, None),
      (
        "./react@17.0.1.js".into(),
        "https://esm.sh/react@17.0.1".into()
      )
    );
    assert_eq!(
      resolver.resolve("/react", false, None),
      (
        "./react@17.0.1.js".into(),
        "https://esm.sh/react@17.0.1".into()
      )
    );
  }

  #[test]
  fn test_resolve_remote_2() {
    let mut resolver = Resolver::new(
      "https://esm.sh/preact/hooks",
      ImportHashMap::default(),
      None,
      false,
      vec![],
    );
    assert_eq!(
      resolver.resolve(
        "https://cdn.esm.sh/preact@10.5.7/es2020/preact.js",
        false,
        None
      ),
      (
        "../../cdn.esm.sh/preact@10.5.7/es2020/preact.js".into(),
        "https://cdn.esm.sh/preact@10.5.7/es2020/preact.js".into()
      )
    );
    assert_eq!(
      resolver.resolve("../preact", false, None),
      ("../preact.js".into(), "https://esm.sh/preact".into())
    );
    assert_eq!(
      resolver.resolve("/preact", false, None),
      ("../preact.js".into(), "https://esm.sh/preact".into())
    );
  }
}
