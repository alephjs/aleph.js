import { hydrate } from "react-dom";
import App from "./app.tsx";

hydrate(<App />, document.querySelector("#root"));
