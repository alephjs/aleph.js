// Copyright 2017-2020 The swc Project Developers. All rights reserved. MIT license.
// Copyright 2020 the Aleph.js authors. All rights reserved. MIT license.

// @ref https://github.com/facebook/react/blob/master/packages/react-refresh/src/ReactFreshBabelPlugin.js

use indexmap::IndexMap;
use sha1::{Digest, Sha1};
use std::rc::Rc;
use swc_common::{SourceMap, Spanned, DUMMY_SP};
use swc_ecma_ast::*;
use swc_ecma_utils::{private_ident, quote_ident};
use swc_ecma_visit::{noop_fold_type, Fold};

pub fn fast_refresh_fold(
  refresh_reg: &str,
  refresh_sig: &str,
  emit_full_signatures: bool,
  source: Rc<SourceMap>,
) -> impl Fold {
  FastRefreshFold {
    source,
    bindings: IndexMap::new(),
    signature_index: 0,
    refresh_reg: refresh_reg.into(),
    refresh_sig: refresh_sig.into(),
    emit_full_signatures,
  }
}

pub struct FastRefreshFold {
  source: Rc<SourceMap>,
  bindings: IndexMap<String, bool>,
  signature_index: u32,
  refresh_reg: String,
  refresh_sig: String,
  emit_full_signatures: bool,
}

#[derive(Clone, Debug)]
struct HookCall {
  object: Option<Ident>,
  ident: Ident,
  key: String,
  is_builtin: bool,
}

#[derive(Clone, Debug)]
struct Signature {
  parent_ident: Ident,
  handle_ident: Ident,
  hook_calls: Vec<HookCall>,
}

impl FastRefreshFold {
  fn get_persistent_fn(
    &mut self,
    ident: &Ident,
    block_stmt: &mut BlockStmt,
  ) -> (Option<Ident>, Option<Signature>) {
    let fc_id = if is_componentish_name(ident.as_ref()) {
      Some(ident.clone())
    } else {
      None
    };
    let mut hook_calls = Vec::<HookCall>::new();
    let mut exotic_signatures = Vec::<(usize, Signature)>::new();
    let mut index: usize = 0;
    let stmts = &mut block_stmt.stmts;

    stmts.into_iter().for_each(|stmt| {
      match stmt {
        // function useFancyState() {}
        Stmt::Decl(Decl::Fn(FnDecl {
          ident,
          function: Function {
            body: Some(body), ..
          },
          ..
        })) => {
          if let (_, Some(signature)) = self.get_persistent_fn(ident, body) {
            exotic_signatures.push((index, signature));
          }
        }
        Stmt::Decl(Decl::Var(VarDecl { decls, .. })) => {
          decls.into_iter().for_each(|decl| match decl {
            VarDeclarator {
              name,
              init: Some(init_expr),
              ..
            } => match init_expr.as_mut() {
              // const useFancyState = function () {}
              Expr::Fn(FnExpr {
                function: Function {
                  body: Some(body), ..
                },
                ..
              }) => {
                if let (_, Some(signature)) = self.get_persistent_fn(ident, body) {
                  exotic_signatures.push((index, signature));
                }
              }
              // const useFancyState = () => {}
              Expr::Arrow(ArrowExpr {
                body: BlockStmtOrExpr::BlockStmt(body),
                ..
              }) => {
                if let (_, Some(signature)) = self.get_persistent_fn(ident, body) {
                  exotic_signatures.push((index, signature));
                }
              }
              // cosnt [state, setState] = useSate()
              Expr::Call(call) => match self.get_hook_call(Some(name.clone()), call) {
                Some(hc) => hook_calls.push(hc),
                _ => {}
              },
              _ => {}
            },
            _ => {}
          });
        }
        // useEffect()
        Stmt::Expr(ExprStmt { expr, .. }) => match expr.as_ref() {
          Expr::Call(call) => match self.get_hook_call(None, call) {
            Some(hc) => hook_calls.push(hc),
            _ => {}
          },
          _ => {}
        },
        // other
        _ => {}
      }
      index += 1;
    });

    // !insert
    // _s();
    let signature = if hook_calls.len() > 0 {
      let mut handle_ident = String::from("_s");
      self.signature_index += 1;
      if self.signature_index > 1 {
        handle_ident.push_str(self.signature_index.to_string().as_str());
      };
      let handle_ident = private_ident!(handle_ident.as_str());
      block_stmt.stmts.insert(
        0,
        Stmt::Expr(ExprStmt {
          span: DUMMY_SP,
          expr: Box::new(Expr::Call(CallExpr {
            span: DUMMY_SP,
            callee: ExprOrSuper::Expr(Box::new(Expr::Ident(handle_ident.clone()))),
            args: vec![],
            type_args: None,
          })),
        }),
      );
      Some(Signature {
        parent_ident: ident.clone(),
        handle_ident,
        hook_calls,
      })
    } else {
      None
    };

    if exotic_signatures.len() > 0 {
      // !insert
      // var _s = $RefreshSig$(), _s2 = $RefreshSig$();
      block_stmt.stmts.insert(
        1,
        Stmt::Decl(Decl::Var(VarDecl {
          span: DUMMY_SP,
          kind: VarDeclKind::Var,
          declare: false,
          decls: exotic_signatures
            .clone()
            .into_iter()
            .map(|signature| VarDeclarator {
              span: DUMMY_SP,
              name: Pat::Ident(signature.1.handle_ident),
              init: Some(Box::new(Expr::Call(CallExpr {
                span: DUMMY_SP,
                callee: ExprOrSuper::Expr(Box::new(Expr::Ident(quote_ident!(self
                  .refresh_sig
                  .as_str())))),
                args: vec![],
                type_args: None,
              }))),
              definite: false,
            })
            .collect(),
        })),
      );

      let mut inserted: usize = 0;
      for (index, exotic_signature) in exotic_signatures {
        let args = self.create_arguments_for_signature(exotic_signature.clone());
        block_stmt.stmts.insert(
          index + inserted + 3,
          Stmt::Expr(ExprStmt {
            span: DUMMY_SP,
            expr: Box::new(Expr::Call(CallExpr {
              span: DUMMY_SP,
              callee: ExprOrSuper::Expr(Box::new(Expr::Ident(
                exotic_signature.handle_ident.clone(),
              ))),
              args,
              type_args: None,
            })),
          }),
        );
        inserted += 1
      }
    }
    (fc_id, signature)
  }

  fn get_hook_call(&self, pat: Option<Pat>, call: &CallExpr) -> Option<HookCall> {
    let callee = match &call.callee {
      ExprOrSuper::Super(_) => return None,
      ExprOrSuper::Expr(callee) => callee.as_ref(),
    };

    let callee = match callee {
      // useState()
      Expr::Ident(id) => Some((None, id)),
      // React.useState()
      Expr::Member(expr) => match &expr.obj {
        ExprOrSuper::Expr(obj) => match obj.as_ref() {
          Expr::Ident(obj) => match expr.prop.as_ref() {
            Expr::Ident(prop) => Some((Some(obj.clone()), prop)),
            _ => None,
          },
          _ => None,
        },
        _ => None,
      },
      _ => None,
    };

    if let Some((obj, id)) = callee {
      let id_str = id.sym.as_ref();
      let is_builtin = is_builtin_hook(
        match &obj {
          Some(obj) => Some(obj.clone()),
          None => None,
        },
        id_str,
      );
      if is_builtin
        || (id_str.len() > 3
          && id_str.starts_with("use")
          && id_str[3..].starts_with(char::is_uppercase))
      {
        let mut key = id_str.to_owned();
        match pat {
          Some(pat) => {
            let name = self.source.span_to_snippet(pat.span()).unwrap();
            key.push('{');
            key.push_str(name.as_str());
            // `useState` first argument is initial state.
            if call.args.len() > 0 && is_builtin && id_str == "useState" {
              key.push('(');
              key.push_str(
                self
                  .source
                  .span_to_snippet(call.args[0].span())
                  .unwrap()
                  .as_str(),
              );
              key.push(')');
            }
            // `useReducer` second argument is initial state.
            if call.args.len() > 1 && is_builtin && id_str == "useReducer" {
              key.push('(');
              key.push_str(
                self
                  .source
                  .span_to_snippet(call.args[1].span())
                  .unwrap()
                  .as_str(),
              );
              key.push(')');
            }
            key.push('}');
          }
          _ => key.push_str("{}"),
        };
        return Some(HookCall {
          object: obj,
          ident: id.clone(),
          key,
          is_builtin,
        });
      }
    }
    None
  }

  fn create_arguments_for_signature(&self, signature: Signature) -> Vec<ExprOrSpread> {
    let mut key = Vec::<String>::new();
    let mut custom_hooks_in_scope = Vec::<(Option<Ident>, Ident)>::new();
    let mut args: Vec<ExprOrSpread> = vec![ExprOrSpread {
      spread: None,
      expr: Box::new(Expr::Ident(signature.parent_ident.clone())),
    }];
    let mut force_reset = false;
    // todo: parse @refresh reset command
    signature.hook_calls.into_iter().for_each(|call| {
      key.push(call.key);
      if !call.is_builtin {
        match call.object {
          Some(obj) => match self.bindings.get(obj.sym.as_ref().into()) {
            Some(_) => custom_hooks_in_scope.push((Some(obj.clone()), call.ident.clone())),
            None => force_reset = true,
          },
          None => match self.bindings.get(call.ident.sym.as_ref().into()) {
            Some(_) => custom_hooks_in_scope.push((None, call.ident.clone())),
            None => force_reset = true,
          },
        }
      }
    });
    let mut key = key.join("\n");
    if !self.emit_full_signatures {
      let mut hasher = Sha1::new();
      hasher.update(key);
      key = base64::encode(hasher.finalize());
    }
    args.push(ExprOrSpread {
      spread: None,
      expr: Box::new(Expr::Lit(Lit::Str(Str {
        span: DUMMY_SP,
        value: key.into(),
        has_escape: false,
      }))),
    });
    if force_reset || custom_hooks_in_scope.len() > 0 {
      args.push(ExprOrSpread {
        spread: None,
        expr: Box::new(Expr::Lit(Lit::Bool(Bool {
          span: DUMMY_SP,
          value: force_reset,
        }))),
      });
    }
    if custom_hooks_in_scope.len() > 0 {
      args.push(ExprOrSpread {
        spread: None,
        expr: Box::new(Expr::Arrow(ArrowExpr {
          span: DUMMY_SP,
          params: vec![],
          body: BlockStmtOrExpr::Expr(Box::new(Expr::Array(ArrayLit {
            span: DUMMY_SP,
            elems: custom_hooks_in_scope
              .into_iter()
              .map(|hook| {
                let (obj, id) = hook;
                if let Some(obj) = obj {
                  Some(ExprOrSpread {
                    spread: None,
                    expr: Box::new(Expr::Member(MemberExpr {
                      span: DUMMY_SP,
                      obj: ExprOrSuper::Expr(Box::new(Expr::Ident(obj.clone()))),
                      prop: Box::new(Expr::Ident(id.clone())),
                      computed: false,
                    })),
                  })
                } else {
                  Some(ExprOrSpread {
                    spread: None,
                    expr: Box::new(Expr::Ident(id.clone())),
                  })
                }
              })
              .collect(),
          }))),
          is_async: false,
          is_generator: false,
          type_params: None,
          return_type: None,
        })),
      });
    }
    args
  }
}

impl Fold for FastRefreshFold {
  noop_fold_type!();

  fn fold_module_items(&mut self, module_items: Vec<ModuleItem>) -> Vec<ModuleItem> {
    let mut items = Vec::<ModuleItem>::new();
    let mut raw_items = Vec::<ModuleItem>::new();
    let mut registrations = Vec::<(Ident, Ident)>::new();
    let mut signatures = Vec::<Signature>::new();

    // collect top bindings
    for item in module_items.clone() {
      match item {
        // import React, {useState} from "/react.js"
        ModuleItem::ModuleDecl(ModuleDecl::Import(ImportDecl { specifiers, .. })) => {
          specifiers
            .into_iter()
            .for_each(|specifier| match specifier {
              ImportSpecifier::Named(ImportNamedSpecifier { local, .. })
              | ImportSpecifier::Default(ImportDefaultSpecifier { local, .. })
              | ImportSpecifier::Namespace(ImportStarAsSpecifier { local, .. }) => {
                self.bindings.insert(local.sym.as_ref().into(), true);
              }
            });
        }

        // export function App() {}
        ModuleItem::ModuleDecl(ModuleDecl::ExportDecl(ExportDecl {
          decl: Decl::Fn(FnDecl { ident, .. }),
          ..
        })) => {
          self.bindings.insert(ident.sym.as_ref().into(), true);
        }

        // export default function App() {}
        ModuleItem::ModuleDecl(ModuleDecl::ExportDefaultDecl(ExportDefaultDecl {
          decl: DefaultDecl::Fn(FnExpr {
            ident: Some(ident), ..
          }),
          ..
        })) => {
          self.bindings.insert(ident.sym.as_ref().into(), true);
        }

        // function App() {}
        ModuleItem::Stmt(Stmt::Decl(Decl::Fn(FnDecl { ident, .. }))) => {
          self.bindings.insert(ident.sym.as_ref().into(), true);
        }

        // const Foo = () => {}
        // export const App = () => {}
        ModuleItem::Stmt(Stmt::Decl(Decl::Var(VarDecl { decls, .. })))
        | ModuleItem::ModuleDecl(ModuleDecl::ExportDecl(ExportDecl {
          decl: Decl::Var(VarDecl { decls, .. }),
          ..
        })) => {
          decls.into_iter().for_each(|decl| match decl {
            VarDeclarator {
              name: Pat::Ident(ident),
              ..
            } => {
              self.bindings.insert(ident.sym.as_ref().into(), true);
            }
            _ => {}
          });
        }

        _ => {}
      };
    }

    for mut item in module_items {
      let mut persistent_fns = Vec::<(Option<Ident>, Option<Signature>)>::new();
      match &mut item {
        // export function App() {}
        ModuleItem::ModuleDecl(ModuleDecl::ExportDecl(ExportDecl {
          decl:
            Decl::Fn(FnDecl {
              ident,
              function: Function {
                body: Some(body), ..
              },
              ..
            }),
          ..
        })) => {
          persistent_fns.push(self.get_persistent_fn(ident, body));
        }

        // export default function App() {}
        ModuleItem::ModuleDecl(ModuleDecl::ExportDefaultDecl(ExportDefaultDecl {
          decl:
            DefaultDecl::Fn(FnExpr {
              ident: Some(ident),
              function: Function {
                body: Some(body), ..
              },
              ..
            }),
          ..
        })) => {
          persistent_fns.push(self.get_persistent_fn(ident, body));
        }

        // function App() {}
        ModuleItem::Stmt(Stmt::Decl(Decl::Fn(FnDecl {
          ident,
          function: Function {
            body: Some(body), ..
          },
          ..
        }))) => {
          persistent_fns.push(self.get_persistent_fn(ident, body));
        }

        // const Foo = () => {}
        // export const App = () => {}
        ModuleItem::Stmt(Stmt::Decl(Decl::Var(VarDecl { decls, .. })))
        | ModuleItem::ModuleDecl(ModuleDecl::ExportDecl(ExportDecl {
          decl: Decl::Var(VarDecl { decls, .. }),
          ..
        })) => {
          decls.into_iter().for_each(|decl| match decl {
            VarDeclarator {
              name: Pat::Ident(ident),
              init: Some(init_expr),
              ..
            } => {
              match init_expr.as_mut() {
                // const Foo = function () {}
                Expr::Fn(FnExpr {
                  function: Function {
                    body: Some(body), ..
                  },
                  ..
                }) => {
                  persistent_fns.push(self.get_persistent_fn(ident, body));
                }
                // const Foo = () => {}
                Expr::Arrow(ArrowExpr {
                  body: BlockStmtOrExpr::BlockStmt(body),
                  ..
                }) => {
                  persistent_fns.push(self.get_persistent_fn(ident, body));
                }
                // const Bar = () => <div />
                Expr::Arrow(ArrowExpr {
                  body: BlockStmtOrExpr::Expr(expr),
                  ..
                }) => match expr.as_ref() {
                  Expr::JSXElement(jsx) => match jsx.as_ref() {
                    JSXElement { .. } => {
                      persistent_fns.push((Some(ident.clone()), None));
                    }
                  },
                  _ => {}
                },
                // const A = forwardRef(function() {
                //   return <h1>Foo</h1>;
                // });
                // const B = memo(React.forwardRef(() => {
                //   return <h1>Foo</h1>;
                // }));
                _ => {}
              };
            }
            _ => {}
          });
        }

        _ => {}
      };

      raw_items.push(item);

      for (fc_id, signature) in persistent_fns {
        if let Some(fc_id) = fc_id {
          let mut registration_handle = String::from("_c");
          let registration_index = registrations.len() + 1;
          if registration_index > 1 {
            registration_handle.push_str(&registration_index.to_string());
          };
          let registration_id = private_ident!(registration_handle.as_str());

          registrations.push((registration_id.clone(), fc_id.clone()));

          // !insert
          // _c = App;
          // _c2 = Foo;
          raw_items.push(ModuleItem::Stmt(Stmt::Expr(ExprStmt {
            span: DUMMY_SP,
            expr: Box::new(Expr::Assign(AssignExpr {
              span: DUMMY_SP,
              op: AssignOp::Assign,
              left: PatOrExpr::Pat(Box::new(Pat::Ident(registration_id))),
              right: Box::new(Expr::Ident(fc_id)),
            })),
          })));
        }

        if let Some(signature) = signature {
          signatures.push(signature);
        }
      }
    }

    // !insert
    // var _c, _c2;
    if registrations.len() > 0 {
      items.push(ModuleItem::Stmt(Stmt::Decl(Decl::Var(VarDecl {
        span: DUMMY_SP,
        kind: VarDeclKind::Var,
        declare: false,
        decls: registrations
          .clone()
          .into_iter()
          .map(|registration| VarDeclarator {
            span: DUMMY_SP,
            name: Pat::Ident(registration.0),
            init: None,
            definite: false,
          })
          .collect(),
      }))));
    }

    // !insert
    // var _s = $RefreshSig$(), _s2 = $RefreshSig$();
    if signatures.len() > 0 {
      items.push(ModuleItem::Stmt(Stmt::Decl(Decl::Var(VarDecl {
        span: DUMMY_SP,
        kind: VarDeclKind::Var,
        declare: false,
        decls: signatures
          .clone()
          .into_iter()
          .map(|signature| VarDeclarator {
            span: DUMMY_SP,
            name: Pat::Ident(signature.handle_ident),
            init: Some(Box::new(Expr::Call(CallExpr {
              span: DUMMY_SP,
              callee: ExprOrSuper::Expr(Box::new(Expr::Ident(quote_ident!(self
                .refresh_sig
                .as_str())))),
              args: vec![],
              type_args: None,
            }))),
            definite: false,
          })
          .collect(),
      }))));
    }

    // insert raw items
    for item in raw_items {
      items.push(item);
    }

    // !insert
    // _s(App, "useState{[count, setCount](0)}\nuseEffect{}");
    for signature in signatures {
      let args = self.create_arguments_for_signature(signature.clone());
      items.push(ModuleItem::Stmt(Stmt::Expr(ExprStmt {
        span: DUMMY_SP,
        expr: Box::new(Expr::Call(CallExpr {
          span: DUMMY_SP,
          callee: ExprOrSuper::Expr(Box::new(Expr::Ident(signature.handle_ident.clone()))),
          args,
          type_args: None,
        })),
      })));
    }

    // !insert
    // $RefreshReg$(_c, "App");
    // $RefreshReg$(_c2, "Foo");
    for (registration_id, fc_id) in registrations {
      items.push(ModuleItem::Stmt(Stmt::Expr(ExprStmt {
        span: DUMMY_SP,
        expr: Box::new(Expr::Call(CallExpr {
          span: DUMMY_SP,
          callee: ExprOrSuper::Expr(Box::new(Expr::Ident(quote_ident!(self
            .refresh_reg
            .as_str())))),
          args: vec![
            ExprOrSpread {
              spread: None,
              expr: Box::new(Expr::Ident(registration_id)),
            },
            ExprOrSpread {
              spread: None,
              expr: Box::new(Expr::Lit(Lit::Str(Str {
                span: DUMMY_SP,
                value: fc_id.sym.clone(),
                has_escape: false,
              }))),
            },
          ],
          type_args: None,
        })),
      })));
    }
    items
  }
}

fn is_componentish_name(name: &str) -> bool {
  name.starts_with(char::is_uppercase)
}

fn is_builtin_hook(obj: Option<Ident>, id: &str) -> bool {
  let ok = match id {
    "useState"
    | "useReducer"
    | "useEffect"
    | "useLayoutEffect"
    | "useMemo"
    | "useCallback"
    | "useRef"
    | "useContext"
    | "useImperativeHandle"
    | "useDebugValue" => true,
    _ => false,
  };
  match obj {
    Some(obj) => match obj.sym.as_ref() {
      "React" => ok,
      _ => false,
    },
    None => ok,
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::swc::ParsedModule;
  use std::cmp::min;
  use swc_ecmascript::parser::JscTarget;

  fn t(specifier: &str, source: &str, expect: &str) -> bool {
    let module =
      ParsedModule::parse(specifier, source, JscTarget::Es2020).expect("could not parse module");
    let (code, _) = module
      .apply_transform(fast_refresh_fold(
        "$RefreshReg$",
        "$RefreshSig$",
        true,
        module.source_map.clone(),
      ))
      .expect("could not transpile module");
    if code != expect {
      let mut p: usize = 0;
      for i in 0..min(code.len(), expect.len()) {
        if code.get(i..i + 1) != expect.get(i..i + 1) {
          p = i;
          break;
        }
      }
      println!(
        "{}\x1b[0;31m_\x1b[0m{}",
        code.get(0..p).unwrap(),
        code.get(p..).unwrap()
      );
    }
    code == expect
  }

  #[test]
  fn test_fast_refresh() {
    let source = r#"
    function Hello() {
      return <h1>Hi</h1>;
    }
    Hello = connect(Hello);
    const Bar = () => {
      return <Hello />;
    };
    var Baz = () => <div />;
    export default function App() {
      const [foo, setFoo] = useState(0);
      const bar = useState(() => 0);
      const [state, dispatch] = useReducer(reducer, initialState, init);
      React.useEffect(() => {}, []);
      return <h1>{foo}</h1>;
    }
    "#;
    let expect = r#"var _c, _c2, _c3, _c4;
var _s = $RefreshSig$();
function Hello() {
    return <h1 >Hi</h1>;
}
_c = Hello;
Hello = connect(Hello);
const Bar = ()=>{
    return <Hello />;
};
_c2 = Bar;
var Baz = ()=><div />
;
_c3 = Baz;
export default function App() {
    _s();
    const [foo, setFoo] = useState(0);
    const bar = useState(()=>0
    );
    const [state, dispatch] = useReducer(reducer, initialState, init);
    React.useEffect(()=>{
    }, []);
    return <h1 >{foo}</h1>;
};
_c4 = App;
_s(App, "useState{[foo, setFoo](0)}\nuseState{bar(() => 0)}\nuseReducer{[state, dispatch](initialState)}\nuseEffect{}");
$RefreshReg$(_c, "Hello");
$RefreshReg$(_c2, "Bar");
$RefreshReg$(_c3, "Baz");
$RefreshReg$(_c4, "App");
"#;
    assert!(t("/app.jsx", source, expect));
  }

  #[test]
  fn test_fast_refresh_custom_hooks() {
    let source = r#"
    const useFancyEffect = () => {
      React.useEffect(() => { });
    };
    function useFancyState() {
      const [foo, setFoo] = React.useState(0);
      useFancyEffect();
      return foo;
    }
    function useFoo() {
      const [x] = useBar(1, 2, 3);
      useBarEffect();
    }
    export default function App() {
      const bar = useFancyState();
      return <h1>{bar}</h1>;
    }
    "#;
    let expect = r#"var _c;
var _s = $RefreshSig$(), _s2 = $RefreshSig$(), _s3 = $RefreshSig$(), _s4 = $RefreshSig$();
const useFancyEffect = ()=>{
    _s();
    React.useEffect(()=>{
    });
};
function useFancyState() {
    _s2();
    const [foo, setFoo] = React.useState(0);
    useFancyEffect();
    return foo;
}
function useFoo() {
    _s3();
    const [x] = useBar(1, 2, 3);
    useBarEffect();
}
export default function App() {
    _s4();
    const bar = useFancyState();
    return <h1 >{bar}</h1>;
};
_c = App;
_s(useFancyEffect, "useEffect{}");
_s2(useFancyState, "useState{[foo, setFoo](0)}\nuseFancyEffect{}", false, ()=>[
        useFancyEffect
    ]
);
_s3(useFoo, "useBar{[x]}\nuseBarEffect{}", true);
_s4(App, "useFancyState{bar}", false, ()=>[
        useFancyState
    ]
);
$RefreshReg$(_c, "App");
"#;
    assert!(t("/app.jsx", source, expect));
  }

  #[test]
  fn test_fast_refresh_exotic_signature() {
    let source = r#"
    import FancyHook from 'fancy';

    export default function App() {
      function useFancyState() {
        const [foo, setFoo] = React.useState(0);
        useFancyEffect();
        return foo;
      }
      const bar = useFancyState();
      const baz = FancyHook.useThing();
      React.useState();
      useThePlatform();
      return <h1>{bar}{baz}</h1>;
    }
    "#;
    let expect = r#"var _c;
var _s2 = $RefreshSig$();
import FancyHook from 'fancy';
export default function App() {
    _s2();
    var _s = $RefreshSig$();
    function useFancyState() {
        _s();
        const [foo, setFoo] = React.useState(0);
        useFancyEffect();
        return foo;
    }
    _s(useFancyState, "useState{[foo, setFoo](0)}\nuseFancyEffect{}", true);
    const bar = useFancyState();
    const baz = FancyHook.useThing();
    React.useState();
    useThePlatform();
    return <h1 >{bar}{baz}</h1>;
};
_c = App;
_s2(App, "useFancyState{bar}\nuseThing{baz}\nuseState{}\nuseThePlatform{}", true, ()=>[
        FancyHook.useThing
    ]
);
$RefreshReg$(_c, "App");
"#;
    assert!(t("/app.jsx", source, expect));
  }

  #[test]
  fn test_fast_refresh_hoc() {
    let source = r#"
    const A = forwardRef(function() {
      return <h1>Foo</h1>;
    });
    const B = memo(React.forwardRef(() => {
      return <h1>Foo</h1>;
    }));
    export default React.memo(forwardRef((props, ref) => {
      return <h1>Foo</h1>;
    }));
    "#;
    let expect = r#"const A = forwardRef(function() {
    return <h1 >Foo</h1>;
});
const B = memo(React.forwardRef(()=>{
    return <h1 >Foo</h1>;
}));
export default React.memo(forwardRef((props, ref)=>{
    return <h1 >Foo</h1>;
}));
"#;
    assert!(t("/app.jsx", source, expect));
  }

  #[test]
  fn test_fast_refresh_ignore() {
    let source = r#"
    const NotAComp = 'hi';
    export { Baz, NotAComp };
    export function sum() {}
    export const Bad = 42;

    let connect = () => {
      function Comp() {
        const handleClick = () => {};
        return <h1 onClick={handleClick}>Hi</h1>;
      }
      return Comp;
    };
    function withRouter() {
      return function Child() {
        const handleClick = () => {};
        return <h1 onClick={handleClick}>Hi</h1>;
      }
    };

    let A = foo ? () => {
      return <h1>Hi</h1>;
    } : null;
    const B = (function Foo() {
      return <h1>Hi</h1>;
    })();
    let C = () => () => {
      return <h1>Hi</h1>;
    };
    let D = bar && (() => {
      return <h1>Hi</h1>;
    });

    const throttledAlert = throttle(function () {
      alert('Hi');
    });
    const TooComplex = function () {
      return hello;
    }(() => {});
    if (cond) {
      const Foo = thing(() => {});
    }

    export default function() {}
    "#;
    let expect = r#"const NotAComp = 'hi';
export { Baz, NotAComp };
export function sum() {
}
export const Bad = 42;
let connect = ()=>{
    function Comp() {
        const handleClick = ()=>{
        };
        return <h1 onClick={handleClick}>Hi</h1>;
    }
    return Comp;
};
function withRouter() {
    return function Child() {
        const handleClick = ()=>{
        };
        return <h1 onClick={handleClick}>Hi</h1>;
    };
}
;
let A = foo ? ()=>{
    return <h1 >Hi</h1>;
} : null;
const B = (function Foo() {
    return <h1 >Hi</h1>;
})();
let C = ()=>()=>{
        return <h1 >Hi</h1>;
    }
;
let D = bar && (()=>{
    return <h1 >Hi</h1>;
});
const throttledAlert = throttle(function() {
    alert('Hi');
});
const TooComplex = function() {
    return hello;
}(()=>{
});
if (cond) {
    const Foo = thing(()=>{
    });
}
export default function() {
};
"#;
    assert!(t("/app.jsx", source, expect));
  }
}
