import { useEffect, useRef, useState } from "react";

export default function Index() {
  const [ready, setReady] = useState(false);
  const editorContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      const { createEditor, createModel } = await import("../lib/editor.ts");
      const editor = createEditor(editorContainerRef.current!);
      editor.setModel(createModel("mod.ts", `console.log("Hello, world!");`));
      setReady(true);
    })();
  }, []);

  return (
    <div style={{ width: "100vw", height: "100vh" }} ref={editorContainerRef}>
      {!ready && <p>Loading...</p>}
    </div>
  );
}
