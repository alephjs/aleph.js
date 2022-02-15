use super::*;
use std::collections::HashMap;

fn transform(specifer: &str, source: &str, options: &EmitOptions) -> (String, Rc<RefCell<Resolver>>) {
  let mut imports: HashMap<String, String> = HashMap::new();
  let mut graph_versions: HashMap<String, i64> = HashMap::new();
  imports.insert("~/".into(), "./".into());
  imports.insert("react".into(), "https://esm.sh/react".into());
  graph_versions.insert("./foo.ts".into(), 100);
  let import_map = ImportHashMap {
    imports,
    scopes: HashMap::new(),
  };
  let module = SWC::parse(specifer, source, swc_ecma_ast::EsVersion::Es2022).expect("could not parse module");
  let resolver = Rc::new(RefCell::new(Resolver::new(
    specifer,
    "https://deno.land/x/aleph",
    "react",
    "17.0.2",
    "v64",
    import_map,
    graph_versions,
    options.is_dev,
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
  let (code, _) = transform("mod.ts", source, &EmitOptions::default());
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
  let (code, _) = transform("./App.tsx", source, &EmitOptions::default());
  assert!(code.contains("\"https://esm.sh/react@17.0.2\""));
  assert!(code.contains("\"./foo.ts?v=100\""));
  assert!(code.contains("\"../style/index.css?module\""));
}

#[test]
fn react_jsx_automtic() {
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
    &EmitOptions {
      jsx_import_source: "https://esm.sh/react@17.0.2".into(),
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
  let (code, _) = transform(
    "./app.tsx",
    source,
    &EmitOptions {
      is_dev: true,
      ..Default::default()
    },
  );
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
fn jsx_magic() {
  let source = r#"
      import React from "https://esm.sh/react"
      export default function Index() {
        return (
          <>
            <head>
              <title>Hello World!</title>
              <link rel="stylesheet" href="../style/index.css" />
            </head>
            <a href="/about">About</a>
            <a href="https://github.com">About</a>
            <a href="/about" target="_blank">About</a>
          </>
        )
      }
    "#;
  let (code, resolver) = transform(
    "./app.tsx",
    source,
    &EmitOptions {
      jsx_magic: true,
      ..Default::default()
    },
  );
  let r = resolver.borrow();
  assert!(code.contains("import __ALEPH__Head from \"/-/deno.land/x/aleph/framework/react/components/Head.ts\""));
  assert!(code.contains("import __ALEPH__Anchor from \"/-/deno.land/x/aleph/framework/react/components/Anchor.ts\""));
  assert!(code.contains("React.createElement(\"a\","));
  assert!(code.contains("React.createElement(__ALEPH__Anchor,"));
  assert!(code.contains("React.createElement(__ALEPH__Head,"));
  assert_eq!(r.jsx_magic_tags.len(), 2);
  assert_eq!(r.deps.len(), 3);
}

#[test]
fn jsx_inlie_style() {
  let source = r#"
      export default function Index() {
        const [color, setColor] = useState('white');

        return (
          <>
            <style>{`
              :root {
                --color: ${color};
              }
            `}</style>
            <style>{`
              h1 {
                font-size: 12px;
              }
            `}</style>
          </>
        )
      }
    "#;
  let (code, resolver) = transform(
    "./app.tsx",
    source,
    &EmitOptions {
      jsx_magic: true,
      ..Default::default()
    },
  );
  let r = resolver.borrow();
  assert!(code
    .contains("import __ALEPH__InlineStyle from \"/-/deno.land/x/aleph/framework/react/components/InlineStyle.ts\""));
  assert!(code.contains("React.createElement(__ALEPH__InlineStyle,"));
  assert!(code.contains("__styleId: \"inline-style-"));
  assert_eq!(r.jsx_inline_styles.len(), 2);
}
