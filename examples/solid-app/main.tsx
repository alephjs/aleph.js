import { hydrate } from "solid-js/web";
import App from "./routes/index.tsx";

hydrate(App, document.getElementById("root")!);
