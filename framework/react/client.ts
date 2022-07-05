import { createElement } from "react";
import { createPortal } from "react-dom";
import { createRoot, hydrateRoot } from "react-dom/client";
import { App } from "./mod.ts";

export function render(selector = "#root") {
  const root = document.querySelector(selector);
  if (!root) throw new Error(`No element found for selector" ${selector}"`);
  createRoot(root).render(createElement(App, { createPortal }));
}

export function hydrate(selector = "#root") {
  const root = document.querySelector(selector);
  if (!root) throw new Error(`No element found for selector" ${selector}"`);
  hydrateRoot(root, createElement(App, { createPortal }));
}
