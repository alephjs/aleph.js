import { createComponent } from "solid-js";
import { hydrate, render } from "solid-js/web";
import { createCSRContext } from "../core/router.ts";
import { Router } from "./router.tsx";

export async function bootstrap(options?: { root?: string | HTMLElement }) {
  const { root = "#root" } = options ?? {};
  const rootEl = typeof root === "string" ? document.querySelector(root) : root;
  if (!rootEl) {
    throw new Error(`Root element "${root}" not found.`);
  }
  const csrContext = await createCSRContext();
  if (document.head.querySelector("script#ssr-data")) {
    hydrate(() => createComponent(Router, { csrContext }), rootEl);
  } else {
    render(() => createComponent(Router, { csrContext }), rootEl);
  }
}

export { Router, useRouter } from "./router.tsx";
