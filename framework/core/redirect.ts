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

// prefetch module using `<link rel="modulepreload" href="...">`
export const prefetchModule = (url: URL) => {
  if (!router) {
    throw new Error("router is not ready.");
  }
  const { getRouteModule } = Reflect.get(window, "__aleph");
  const deploymentId = window.document.body.getAttribute("data-deployment-id");
  const matches = matchRoutes(url, router);
  matches.map(([_, meta]) => {
    const { filename } = meta;
    try {
      getRouteModule(filename);
    } catch (_e) {
      const link = document.createElement("link");
      let href = meta.filename.slice(1);
      if (deploymentId) {
        href += `?v=${deploymentId}`;
      }
      link.setAttribute("rel", "modulepreload");
      link.setAttribute("href", href);
      document.head.appendChild(link);
    }
  });
};
