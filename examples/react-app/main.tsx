import { App } from "aleph/react";
import { hydrateRoot } from "react-dom/client";

hydrateRoot(document.querySelector("#root")!, <App />);
