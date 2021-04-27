use std::{fmt, sync::Arc, sync::RwLock};
use swc_common::{
  errors::{Diagnostic, DiagnosticBuilder, Emitter},
  Loc, Span,
};

/// A buffer for collecting errors from the AST parser.
#[derive(Debug, Clone)]
pub struct ErrorBuffer {
  specifier: String,
  diagnostics: Arc<RwLock<Vec<Diagnostic>>>,
}

impl ErrorBuffer {
  pub fn new(specifier: &str) -> Self {
    Self {
      specifier: specifier.into(),
      diagnostics: Arc::new(RwLock::new(Vec::new())),
    }
  }
}

impl Emitter for ErrorBuffer {
  fn emit(&mut self, diagnostic_builder: &DiagnosticBuilder) {
    self
      .diagnostics
      .write()
      .unwrap()
      .push((**diagnostic_builder).clone());
  }
}

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
    let diagnostics = error_buffer.diagnostics.read().unwrap().clone();
    let diagnostics = diagnostics
      .iter()
      .map(|d| {
        let mut message = d.message();
        if let Some(span) = d.span.primary_span() {
          let loc = get_loc(span);
          message = format!(
            "{} at {}:{}:{}",
            message, error_buffer.specifier, loc.line, loc.col_display
          );
        }
        message
      })
      .collect();

    Self(diagnostics)
  }
}
