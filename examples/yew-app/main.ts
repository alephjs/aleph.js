import init, { main } from "./pkg/yew_app.js";

init().then(main);

import.meta.hot?.decline(500);
