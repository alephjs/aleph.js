use swc_common::DUMMY_SP;
use swc_ecma_ast::*;
use swc_ecma_utils::quote_ident;

pub fn rename_var_decl(new_name: &str, old: &str) -> ModuleItem {
  ModuleItem::Stmt(Stmt::Decl(Decl::Var(VarDecl {
    span: DUMMY_SP,
    kind: VarDeclKind::Const,
    declare: false,
    decls: vec![VarDeclarator {
      span: DUMMY_SP,
      name: pat_id(new_name),
      init: Some(Box::new(Expr::Ident(quote_ident!(old)))),
      definite: false,
    }],
  })))
}

pub fn window_assign(name: &str, expr: Expr) -> ModuleItem {
  ModuleItem::Stmt(Stmt::Expr(ExprStmt {
    span: DUMMY_SP,
    expr: Box::new(Expr::Assign(AssignExpr {
      span: DUMMY_SP,
      op: AssignOp::Assign,
      left: PatOrExpr::Expr(Box::new(simple_member_expr("window", name))),
      right: Box::new(expr),
    })),
  }))
}

pub fn pat_id(id: &str) -> Pat {
  Pat::Ident(BindingIdent {
    id: quote_ident!(id),
    type_ann: None,
  })
}

pub fn import_name(name: &str) -> ImportSpecifier {
  ImportSpecifier::Named(ImportNamedSpecifier {
    span: DUMMY_SP,
    local: quote_ident!(name),
    imported: None,
    is_type_only: false,
  })
}

pub fn new_member_expr(obj: Expr, key: &str) -> Expr {
  Expr::Member(MemberExpr {
    span: DUMMY_SP,
    obj: Box::new(obj),
    prop: MemberProp::Ident(quote_ident!(key)),
  })
}

pub fn simple_member_expr(obj: &str, key: &str) -> Expr {
  Expr::Member(MemberExpr {
    span: DUMMY_SP,
    obj: Box::new(Expr::Ident(quote_ident!(obj))),
    prop: MemberProp::Ident(quote_ident!(key)),
  })
}

pub fn is_call_expr_by_name(call: &CallExpr, name: &str) -> bool {
  let callee = match &call.callee {
    Callee::Super(_) => return false,
    Callee::Import(_) => return false,
    Callee::Expr(callee) => callee.as_ref(),
  };

  match callee {
    Expr::Ident(id) => id.sym.as_ref().eq(name),
    _ => false,
  }
}

pub fn new_str(s: &str) -> Str {
  Str {
    span: DUMMY_SP,
    value: s.into(),
    has_escape: false,
    kind: Default::default(),
  }
}
