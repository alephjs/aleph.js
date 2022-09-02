import { createElement } from "react";
import { createPortal } from "react-dom";
import { createRoot, hydrateRoot } from "react-dom/client";
import { App } from "./mod.ts";

export function bootstrap(options?: { mountPoint?: string | HTMLElement; hydrate?: boolean }) {
  const { mountPoint = "#root", hydrate } = options ?? {};
  const rootEl = typeof mountPoint === "string" ? document.querySelector(mountPoint) : mountPoint;
  if (typeof mountPoint === "string" && !rootEl) {
    throw new Error(`No element found for selector" ${mountPoint}"`);
  }
  const el = createElement(App, { createPortal });
  if (hydrate) {
    hydrateRoot(rootEl, el);
  } else {
    createRoot(rootEl).render(el);
  }
}
