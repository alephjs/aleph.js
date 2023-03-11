import { isFilledString } from "../../shared/util.ts";
import events from "./events.ts";

let hasRouter = false;
let preRedirect: URL | null = null;

const onrouter = (_: Record<string, unknown>) => {
  events.off("router", onrouter);
  if (preRedirect) {
    events.emit("popstate", { type: "popstate", url: preRedirect });
    preRedirect = null;
  }
  hasRouter = true;
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

  if (hasRouter) {
    if (!Reflect.has(globalThis, "navigation")) {
      events.emit("popstate", { type: "popstate", url });
    }
  } else {
    preRedirect = url;
  }
}
