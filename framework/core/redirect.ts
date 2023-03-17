import { isFilledString } from "../../shared/util.ts";
import events from "./events.ts";
import { matchRoutes, type Router } from "./router.ts";

let router: Router | null = null;
let preRedirect: URL | null = null;

const onrouter = (e: Record<string, unknown>) => {
  events.off("router", onrouter);
  if (preRedirect) {
    events.emit("popstate", { type: "popstate", url: preRedirect });
    preRedirect = null;
  }
  router = e.router as Router;
};
events.on("router", onrouter);

export function redirect(href: string, replace?: boolean) {
  const { history, location } = globalThis;
  if (!isFilledString(href) || !history || !location) {
    return;
  }

  if (href.startsWith("file://") || href.startsWith("mailto:") || href.startsWith("data:")) {
    location.href = href;
    return;
  }

  const url = new URL(href, location.href);
  if (url.href === location.href) {
    return;
  }
  if (url.host !== location.host) {
    location.href = href;
    return;
  }

  if (replace) {
    history.replaceState(null, "", url);
  } else {
    history.pushState(null, "", url);
  }

  if (router) {
    if (!Reflect.has(globalThis, "navigation")) {
      events.emit("popstate", { type: "popstate", url });
    }
  } else {
    preRedirect = url;
  }
}

const prefetched = new Set<string>();

/** prefetch module using `<link rel="modulepreload" href="...">` */
export const prefetchModule = (url: URL) => {
  if (prefetched.has(url.href)) {
    return;
  }
  prefetched.add(url.href);
  if (!router) {
    throw new Error("router is not ready.");
  }
  const deploymentId = window.document.body.getAttribute("data-deployment-id");
  const q = deploymentId ? `?v=${deploymentId}` : "";
  const matches = matchRoutes(url, router);
  matches.map(([_, meta]) => {
    if (!document.querySelector(`link[data-module-id="${meta.filename}"]`)) {
      const link = document.createElement("link");
      link.setAttribute("rel", "modulepreload");
      link.setAttribute("href", meta.filename.slice(1) + q);
      link.setAttribute("data-module-id", meta.filename);
      document.head.appendChild(link);
    }
  });
};
