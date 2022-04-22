import { Router } from "aleph/react";
import { hydrateRoot } from "react-dom/client";

hydrateRoot(document.querySelector("#root")!, <Router />);
