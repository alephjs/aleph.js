import { createElement } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { App, RouterProps } from "./mod.ts";

export type RenderOptions = {
  root?: string | HTMLElement;
  createPortal?: RouterProps["createPortal"];
  hydrate?: boolean;
};

export function bootstrap(options: RenderOptions = {}) {
  const { root = "#root", createPortal, hydrate = !!document.head.querySelector("script#ssr-data") } = options;
  const rootEl = typeof root === "string" ? document.querySelector(root) : root;
  if (!rootEl) {
    throw new Error(`No element found for selector "${root}"`);
  }
  const el = createElement(App, { createPortal });
  if (hydrate) {
    hydrateRoot(rootEl, el);
  } else {
    createRoot(rootEl).render(el);
  }
}
