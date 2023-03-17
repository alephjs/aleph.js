import { createElement } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { App, RouterProps } from "./mod.ts";
import { createCSRContext } from "../core/router.ts";

export type RenderOptions = {
  root?: string | HTMLElement | null;
  createPortal?: RouterProps["createPortal"];
};

export async function bootstrap(options: RenderOptions = {}) {
  const { root = "#root", createPortal } = options;
  const rootEl = typeof root === "string" ? document.querySelector(root) : root;
  if (!rootEl) {
    throw new Error(`No element found for selector "${root}"`);
  }
  const csrContext = await createCSRContext();
  const el = createElement(App, { csrContext, createPortal });
  if (document.head.querySelector("script#ssr-data")) {
    hydrateRoot(rootEl, el);
  } else {
    createRoot(rootEl).render(el);
  }
}
