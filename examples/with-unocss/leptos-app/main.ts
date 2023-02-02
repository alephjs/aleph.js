import init, { hydrate } from "./pkg/client.js";

// reload page on rebuild
import.meta.hot?.decline();

// run app main
init().then(hydrate);
