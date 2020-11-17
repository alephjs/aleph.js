// Copyright 2018-2020 the Deno authors. All rights reserved. MIT license.
// Copyright 2020 the Aleph.js authors. All rights reserved. MIT license.

use std::error::Error;
use std::fmt;
use std::sync::Arc;
use std::sync::RwLock;
use swc_common::{
    errors::{Diagnostic, DiagnosticBuilder, Emitter},
    FileName, Loc, Span,
};

/// A buffer for collecting diagnostic messages from the AST parser.
#[derive(Debug)]
pub struct DiagnosticBuffer(Vec<String>);

impl Error for DiagnosticBuffer {}

impl fmt::Display for DiagnosticBuffer {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = self.0.join(",");
        f.pad(&s)
    }
}

impl DiagnosticBuffer {
    pub fn from_error_buffer<F>(error_buffer: ErrorBuffer, get_loc: F) -> Self
    where
        F: Fn(Span) -> Loc,
    {
        let s = error_buffer.0.read().unwrap().clone();
        let diagnostics = s
            .iter()
            .map(|d| {
                let mut msg = d.message();

                if let Some(span) = d.span.primary_span() {
                    let loc = get_loc(span);
                    let file_name = match &loc.file.name {
                        FileName::Real(p) => p.display(),
                        _ => unreachable!(),
                    };
                    msg = format!("{} at {}:{}:{}", msg, file_name, loc.line, loc.col_display);
                }

                msg
            })
            .collect::<Vec<String>>();

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
    fn emit(&mut self, db: &DiagnosticBuilder) {
        self.0.write().unwrap().push((**db).clone());
    }
}
