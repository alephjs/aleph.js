use swc_common::{sync::Lrc, FileName, SourceMap, DUMMY_SP};
use swc_ecma_ast::*;
use swc_ecma_utils::quote_ident;
use swc_ecma_visit::{noop_fold_type, Fold};

pub fn aleph_jsx(source: Lrc<SourceMap>, is_dev: bool) -> impl Fold {
    AlephJsx { source, is_dev }
}

// aleph.js jsx transform, core functions include:
// 1. rewrite `Import` path
// 2. add `__source` prop in development
struct AlephJsx {
    source: Lrc<SourceMap>,
    is_dev: bool,
}

impl Fold for AlephJsx {
    noop_fold_type!();

    fn fold_jsx_opening_element(&mut self, mut el: JSXOpeningElement) -> JSXOpeningElement {
        if el.span == DUMMY_SP {
            return el;
        }

        if is_import_jsx_element(&el.name) {
            el.attrs.push(JSXAttrOrSpread::JSXAttr(JSXAttr {
                span: DUMMY_SP,
                name: JSXAttrName::Ident(quote_ident!("__foo")),
                value: Some(JSXAttrValue::Lit(Lit::Str(Str {
                    span: DUMMY_SP,
                    value: "bar".into(),
                    has_escape: false,
                }))),
            }));
        }

        // copy from https://github.com/swc-project/swc/blob/master/ecmascript/transforms/src/react/jsx_src.rs
        if self.is_dev {
            let file_lines = match self.source.span_to_lines(el.span) {
                Ok(v) => v,
                _ => return el,
            };
            el.attrs.push(JSXAttrOrSpread::JSXAttr(JSXAttr {
                span: DUMMY_SP,
                name: JSXAttrName::Ident(quote_ident!("__source")),
                value: Some(JSXAttrValue::JSXExprContainer(JSXExprContainer {
                    span: DUMMY_SP,
                    expr: JSXExpr::Expr(Box::new(
                        ObjectLit {
                            span: DUMMY_SP,
                            props: vec![
                                PropOrSpread::Prop(Box::new(Prop::KeyValue(KeyValueProp {
                                    key: PropName::Ident(quote_ident!("fileName")),
                                    value: Box::new(Expr::Lit(Lit::Str(Str {
                                        span: DUMMY_SP,
                                        value: match file_lines.file.name {
                                            FileName::Real(ref p) => p.display().to_string().into(),
                                            _ => unimplemented!(
                                                "file name for other than real files"
                                            ),
                                        },
                                        has_escape: false,
                                    }))),
                                }))),
                                PropOrSpread::Prop(Box::new(Prop::KeyValue(KeyValueProp {
                                    key: PropName::Ident(quote_ident!("lineNumber")),
                                    value: Box::new(Expr::Lit(Lit::Num(Number {
                                        span: DUMMY_SP,
                                        value: (file_lines.lines[0].line_index + 1) as _,
                                    }))),
                                }))),
                            ],
                        }
                        .into(),
                    )),
                })),
            }));
        }

        el
    }
}

// match <Import from="..." />
fn is_import_jsx_element(name: &JSXElementName) -> bool {
    match name {
        JSXElementName::Ident(i) => i.sym.chars().as_str().eq("Import"),
        JSXElementName::JSXMemberExpr(ref _n) => false,
        JSXElementName::JSXNamespacedName(ref _n) => false,
    }
}
