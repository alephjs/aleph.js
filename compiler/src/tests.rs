use super::*;
use std::collections::HashMap;

fn transform(specifer: &str, source: &str, is_dev: bool, options: &EmitOptions) -> (String, Rc<RefCell<Resolver>>) {
  let mut imports: HashMap<String, String> = HashMap::new();
  let mut graph_versions: HashMap<String, String> = HashMap::new();
  imports.insert("~/".into(), "./".into());
  imports.insert("react".into(), "https://esm.sh/react".into());
  graph_versions.insert("./foo.ts".into(), "100".into());
  let import_map = ImportHashMap {
    imports,
    scopes: HashMap::new(),
  };
  let module = SWC::parse(specifer, source, swc_ecma_ast::EsVersion::Es2022).expect("could not parse module");
  let resolver = Rc::new(RefCell::new(Resolver::new(
    specifer,
    "https://deno.land/x/aleph",
    "react",
    Some("17.0.2".into()),
    Some("v64".into()),
    import_map,
    graph_versions,
    None,
    is_dev,
  )));
  let (code, _) = module.transform(resolver.clone(), options).unwrap();
  println!("{}", code);
  (code, resolver)
}

#[test]
fn typescript() {
  let source = r#"
       enum D {
        A,
        B,
        C,
      }

      function enumerable(value: boolean) {
        return function (
          _target: any,
          _propertyKey: string,
          descriptor: PropertyDescriptor,
        ) {
          descriptor.enumerable = value;
        };
      }

      export class A {
        private b: string;
        protected c: number = 1;
        e: "foo";
        constructor (public d = D.A) {
          const e = "foo" as const;
          this.e = e;
        }
        @enumerable(false)
        bar() {}
      }
    "#;
  let (code, _) = transform("mod.ts", source, false, &EmitOptions::default());
  assert!(code.contains("var D;\n(function(D) {\n"));
  assert!(code.contains("_applyDecoratedDescriptor("));
}

#[test]
fn import_resolving() {
  let source = r#"
      import React from "react"
      import { foo } from "./foo.ts"
      import "../style/index.css"

      foo();
      <div/>
    "#;
  let (code, _) = transform("./App.tsx", source, false, &EmitOptions::default());
  assert!(code.contains("\"https://esm.sh/react@17.0.2\""));
  assert!(code.contains("\"./foo.ts?v=100\""));
  assert!(code.contains("\"../style/index.css?module\""));
}

#[test]
fn jsx_automtic() {
  let source = r#"
      export default function App() {
        return (
          <>
            <h1 className="title">Hello world!</h1>
          </>
        )
      }
    "#;
  let (code, _) = transform(
    "./app.tsx",
    source,
    false,
    &EmitOptions {
      jsx_import_source: Some("https://esm.sh/react@17.0.2".to_owned()),
      ..Default::default()
    },
  );
  assert!(
    code.contains("import { jsx as _jsx, Fragment as _Fragment } from \"https://esm.sh/react@17.0.2/jsx-runtime\"")
  );
  assert!(code.contains("_jsx(_Fragment, {"));
  assert!(code.contains("_jsx(\"h1\", {"));
  assert!(code.contains("children: \"Hello world!\""));
}

#[test]
fn react_dev() {
  let source = r#"
      import { useState } from "react"
      export default function App() {
        const [ msg ] = useState('Hello world!')
        return (
          <h1 className="title">{msg}{foo()}</h1>
        )
      }
    "#;
  let (code, _) = transform("./app.tsx", source, true, &EmitOptions::default());
  assert!(code.contains(
    "import { __REACT_REFRESH_RUNTIME__, __REACT_REFRESH__ } from \"/-/deno.land/x/aleph/framework/react/refresh.ts\""
  ));
  assert!(code.contains("const prevRefreshReg = $RefreshReg$"));
  assert!(code.contains("const prevRefreshSig = $RefreshSig$"));
  assert!(code.contains(
    "window.$RefreshReg$ = (type, id)=>__REACT_REFRESH_RUNTIME__.register(type, \"./app.tsx\" + (\"#\" + id))"
  ));
  assert!(code.contains("window.$RefreshSig$ = __REACT_REFRESH_RUNTIME__.createSignatureFunctionForTransform"));
  assert!(code.contains("var _s = $RefreshSig$()"));
  assert!(code.contains("_s()"));
  assert!(code.contains("_c = App"));
  assert!(code.contains("$RefreshReg$(_c, \"App\")"));
  assert!(code.contains("window.$RefreshReg$ = prevRefreshReg"));
  assert!(code.contains("window.$RefreshSig$ = prevRefreshSig;"));
  assert!(code.contains("import.meta.hot?.accept(__REACT_REFRESH__)"));
}

#[test]
fn jsx_class_names() {
  let source = r#"
      export default function Index() {
        const [color, setColor] = useState('white');

        return (
          <div className="mt-4 flex">
            <div className={"p-4" + " " + (bold ? "bold" : "font-sm")}>
              <div class={`font-lg ${"fw-600"}`} />
            </div>
          </div>
        )
      }
    "#;
  let (_, resolver) = transform(
    "./app.tsx",
    source,
    false,
    &EmitOptions {
      parse_jsx_static_classes: true,
      ..Default::default()
    },
  );
  let r = resolver.borrow();
  assert_eq!(r.jsx_static_classes.len(), 7);
}

#[test]
fn strip_data_export() {
  let source = r#"
      import { json } from "./helper.ts"
      const count = 0;
      export const data = {
        get: (req: Request) => {
         return json({ count })
        },
        post: (req: Request) => {
          return json({ count })
         }
      }
    "#;
  let (code, _) = transform(
    "./app.tsx",
    source,
    false,
    &EmitOptions {
      strip_data_export: true,
      ..Default::default()
    },
  );
  assert!(code.contains("export const data = true"));
  assert!(!code.contains("import { json } from \"./helper.ts\""));
}
