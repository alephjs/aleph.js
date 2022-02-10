use super::*;
use std::collections::HashMap;

fn transform(
    specifer: &str,
    source: &str,
    options: &EmitOptions,
) -> (String, Rc<RefCell<Resolver>>) {
    let mut imports: HashMap<String, String> = HashMap::new();
    imports.insert("~/".into(), "./".into());
    imports.insert("react".into(), "https://esm.sh/react".into());
    let module = SWC::parse(specifer, source).expect("could not parse module");
    let resolver = Rc::new(RefCell::new(Resolver::new(
        specifer,
        ImportHashMap {
            imports,
            scopes: HashMap::new(),
        },
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
    let (code, _) = transform(
        "https://deno.land/x/mod.ts",
        source,
        &EmitOptions::default(),
    );
    assert!(code.contains("var D;\n(function(D) {\n"));
    assert!(code.contains("_applyDecoratedDescriptor("));
}

#[test]
fn react_jsx() {
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
        "app.tsx",
        source,
        &EmitOptions {
            jsx_import_source: "https://esm.sh/react@17.0.2".into(),
            ..Default::default()
        },
    );
    assert!(code.contains("import { jsx as _jsx, Fragment as _Fragment } from \"https://esm.sh/react@17.0.2/jsx-runtime\""));
    assert!(code.contains("_jsx(_Fragment, {"));
    assert!(code.contains("_jsx(\"h1\", {"));
    assert!(code.contains("children: \"Hello world!\""));
}

#[test]
fn react_jsx_dev() {
    let source = r#"
      import { useState } from "https://esm.sh/react"
      export default function App() {
				const [ msg ] = useState('Hello world!')
        return (
					<h1 className="title">{msg}</h1>
        )
      }
    "#;
    let (code, _) = transform(
        "/app.tsx",
        source,
        &EmitOptions {
            is_dev: true,
            ..Default::default()
        },
    );
    assert!(code.contains("var _s = $RefreshSig$()"));
    assert!(code.contains("_s()"));
    assert!(code.contains("_c = App"));
    assert!(code.contains("$RefreshReg$(_c, \"App\")"));
}
