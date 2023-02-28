import { createEditor, createModel } from "./editor.ts";

const el = document.querySelector(".editor");
const editor = createEditor(el as HTMLElement);
const model = createModel("mod.ts", `// Monaco Editor x Aleph.js (SPA mode) \n\nconsole.log("Hello, world!");\n`);

el!.innerHTML = "";
editor.setModel(model);
