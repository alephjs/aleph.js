import { useEffect, useRef, useState } from "react";
import type { editor } from "https://esm.sh/monaco-editor@0.33.0";

export default function Index() {
  const [ready, setReady] = useState(false);
  const editorRef = useRef<editor.IStandaloneCodeEditor>();
  const editorContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      const { createEditor, createModel } = await import("../lib/editor.ts");
      editorRef.current = createEditor(editorContainerRef.current!);
      editorRef.current.setModel(createModel("mod.ts", `console.log("Hello, world!");`));
      setReady(true);
    })();
  }, []);

  return (
    <div style={{ width: "100vw", height: "100vh" }} ref={editorContainerRef}>
      {!ready && <p>Loading...</p>}
    </div>
  );
}
