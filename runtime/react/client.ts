import { createElement } from "react";
import { createPortal } from "react-dom";
import { createRoot, hydrateRoot } from "react-dom/client";
import { App } from "./mod.ts";

export function bootstrap(options?: { root?: string | HTMLElement; hydrate?: boolean }) {
  const { root = "#root", hydrate = !!document.head.querySelector("script#ssr-data") } = options ?? {};
  const rootEl = typeof root === "string" ? document.querySelector(root) : root;
  if (typeof root === "string" && !rootEl) {
    throw new Error(`No element found for selector "${root}"`);
  }
  const el = createElement(App, { createPortal });
  if (hydrate) {
    hydrateRoot(rootEl, el);
  } else {
    createRoot(rootEl).render(el);
  }
}
