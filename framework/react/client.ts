import { createElement } from "react";
import { createPortal } from "react-dom";
import { createRoot, hydrateRoot } from "react-dom/client";
import { App } from "./mod.ts";

export function render(root: string | HTMLElement = "#root", hydrate = false) {
  const rootSelector = typeof root === "string" ? root : undefined;
  const rootEl = rootSelector ? document.querySelector(rootSelector) : root;
  if (rootSelector && !rootEl) throw new Error(`No element found for selector" ${rootSelector}"`);
  const el = createElement(App, { createPortal });
  if (hydrate) hydrateRoot(rootEl, el);
  else createRoot(rootEl).render(el);
}

export function hydrate(selector = "#root") {
  render(selector, true);
}
