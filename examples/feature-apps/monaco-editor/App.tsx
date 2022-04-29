import { useEffect, useRef, useState } from "react";

export default function App() {
  const [ready, setReady] = useState(false);
  const editorContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      const { createEditor, createModel } = await import("./editor.ts");
      const editor = createEditor(editorContainerRef.current!);
      editor.setModel(createModel("mod.ts", `// Aleph.js with Monaco Editor \n\nconsole.log("Hello, world!");\n`));
      setReady(true);
    })();
  }, []);

  return (
    <div className="editor" ref={editorContainerRef}>
      {!ready && <p>Loading...</p>}
    </div>
  );
}
