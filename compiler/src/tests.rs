use super::*;
use std::collections::HashMap;

fn transform(specifer: &str, source: &str, is_dev: bool, options: &EmitOptions) -> (String, Rc<RefCell<Resolver>>) {
  let importmap = import_map::parse_from_json(
    &Url::from_file_path("/").unwrap(),
    r#"{
    "imports": {
      "~/": "./",
      "react": "https://esm.sh/react"
    }
  }"#,
  )
  .expect("could not pause the import map")
  .import_map;
  let mut graph_versions: HashMap<String, String> = HashMap::new();
  graph_versions.insert("./foo.ts".into(), "100".into());
  let module = SWC::parse(specifer, source, swc_ecma_ast::EsVersion::Es2022).expect("could not parse module");
  let resolver = Rc::new(RefCell::new(Resolver::new(
    specifer,
    "https://deno.land/x/aleph",
    Some("react".into()),
    Some("17.0.2".into()),
    Some("64".into()),
    importmap,
    graph_versions,
    None,
    is_dev,
    true,
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
      import React from "https://cdn.esm.sh/v66/react-dom@16.0.4"
      import { foo } from "~/foo.ts"
      import "../../style/app.css"

      foo()
      export default () => <div />
    "#;
  let (code, _) = transform("./pages/blog/$id.tsx", source, false, &EmitOptions::default());
  assert!(code.contains("\"/-/esm.sh/react@17.0.2\""));
  assert!(code.contains("\"/-/cdn.esm.sh/v64/react-dom@17.0.2\""));
  assert!(code.contains("\"../../foo.ts?v=100\""));
  assert!(code.contains("\"../../style/app.css?module\""));
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

#[test]
fn parse_export_names() {
  let source = r#"
    export const name = "alephjs"
    export const version = "1.0.1"
    const start = () => {}
    export default start
    export const { build } = { build: () => {} }
    export function dev() {}
    export class Server {}
    export const { a: { a1, a2 }, 'b': [ b1, b2 ], c, ...rest } = { a: { a1: 0, a2: 0 }, b: [ 0, 0 ], c: 0, d: 0 }
    export const [ d, e, ...{f, g, rest3} ] = [0, 0, {f:0,g:0,h:0}]
    let i
    export const j = i = [0, 0]
    export { exists, existsSync } from "https://deno.land/std/fs/exists.ts"
    export * as DenoStdServer from "https://deno.land/std/http/sever.ts"
    export * from "https://deno.land/std/http/sever.ts"
  "#;
  let module = SWC::parse("/app.ts", source, EsVersion::Es2022).expect("could not parse module");
  assert_eq!(
    module.parse_export_names().unwrap(),
    vec![
      "name",
      "version",
      "default",
      "build",
      "dev",
      "Server",
      "a1",
      "a2",
      "b1",
      "b2",
      "c",
      "rest",
      "d",
      "e",
      "f",
      "g",
      "rest3",
      "j",
      "exists",
      "existsSync",
      "DenoStdServer",
      "{https://deno.land/std/http/sever.ts}",
    ]
    .into_iter()
    .map(|s| s.to_owned())
    .collect::<Vec<String>>()
  )
}
