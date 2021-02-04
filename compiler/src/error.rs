// Copyright 2020-2021 postUI Lab. All rights reserved. MIT license.

use std::{fmt, sync::Arc, sync::RwLock};
use swc_common::{
  errors::{Diagnostic, DiagnosticBuilder, Emitter},
  FileName, Loc, Span,
};

/// A buffer for collecting diagnostic messages from the AST parser.
#[derive(Debug)]
pub struct DiagnosticBuffer(Vec<String>);

impl fmt::Display for DiagnosticBuffer {
  fn fmt(&self, fmt: &mut fmt::Formatter<'_>) -> fmt::Result {
    fmt.pad(&self.0.join(","))
  }
}

impl DiagnosticBuffer {
  pub fn from_error_buffer<F>(error_buffer: ErrorBuffer, get_loc: F) -> Self
  where
    F: Fn(Span) -> Loc,
  {
    let diagnostics = error_buffer.0.read().unwrap().clone();
    let diagnostics = diagnostics
      .iter()
      .map(|d| {
        let mut message = d.message();

        if let Some(span) = d.span.primary_span() {
          let loc = get_loc(span);
          let file_name = match &loc.file.name {
            FileName::Real(p) => p.display(),
            _ => unreachable!(),
          };
          message = format!(
            "{} at {}:{}:{}",
            message, file_name, loc.line, loc.col_display
          );
        }

        message
      })
      .collect();

    Self(diagnostics)
  }
}

/// A buffer for collecting errors from the AST parser.
#[derive(Debug, Clone)]
pub struct ErrorBuffer(Arc<RwLock<Vec<Diagnostic>>>);

impl ErrorBuffer {
  pub fn new() -> Self {
    Self(Arc::new(RwLock::new(Vec::new())))
  }
}

impl Emitter for ErrorBuffer {
  fn emit(&mut self, diagnostic_builder: &DiagnosticBuilder) {
    self.0.write().unwrap().push((**diagnostic_builder).clone());
  }
}
