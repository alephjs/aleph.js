// Copyright Deno Land Inc. All Rights Reserved. Proprietary and confidential.

import { editor, Uri } from "https://esm.sh/monaco-editor@0.33.0";
import editorWorker from "https://esm.sh/monaco-editor@0.33.0/esm/vs/editor/editor.worker?worker";
import tsWorker from "https://esm.sh/monaco-editor@0.33.0/esm/vs/language/typescript/ts.worker?worker";
import "https://esm.sh/v74/monaco-editor@0.33.0/es2021/monaco-editor.css";

// deno-lint-ignore ban-ts-comment
// @ts-ignore
self.MonacoEnvironment = {
  getWorker(_: unknown, label: string) {
    if (label === "typescript" || label === "javascript") {
      return tsWorker();
    }
    return editorWorker();
  },
};

export function createModel(name: string, source: string) {
  const lang = getLanguage(name);
  if (!lang) {
    return null;
  }

  const uri = Uri.parse(`file:///playground/${name}`);
  const model = editor.createModel(source, lang, uri);
  return model;
}

export function createEditor(container: HTMLElement, readOnly?: boolean) {
  return editor.create(container, {
    readOnly,
    automaticLayout: true,
    contextmenu: true,
    fontFamily: '"Dank Mono", "Source Code Pro", monospace',
    fontLigatures: true,
    fontSize: 14,
    lineHeight: 18,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    smoothScrolling: true,
    scrollbar: {
      useShadows: false,
      verticalScrollbarSize: 10,
      horizontalScrollbarSize: 10,
    },
    overviewRulerLanes: 0,
  });
}

function getLanguage(name: string) {
  switch (name.slice(name.lastIndexOf(".") + 1).toLowerCase()) {
    case "ts":
    case "tsx":
      return "typescript";
    case "js":
    case "jsx":
      return "javascript";
  }
  return null;
}
