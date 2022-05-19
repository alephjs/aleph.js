import init, { main } from "./pkg/yew_app.js";

init("/pkg/yew_app_bg.wasm").then(main);

import.meta.hot?.decline();
