import init, { main } from "./pkg/leptos_app.js";

// reload page on rebuild
import.meta.hot?.decline();

// run app main
init().then(main);
