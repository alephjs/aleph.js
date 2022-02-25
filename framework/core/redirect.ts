import util from "../../lib/util.ts";
import events from "./events.ts";

let routerReady = false;
let hasPreRedirect = false;

const onrouterready = (_: Record<string, unknown>) => {
  events.off("routerready", onrouterready);
  if (hasPreRedirect) {
    events.emit("popstate", { type: "popstate", resetScroll: true });
  }
  routerReady = true;
};
events.on("routerready", onrouterready);

export function redirect(url: string, replace?: boolean) {
  const { location, history } = window;

  if (!util.isFilledString(url)) {
    return;
  }

  if (util.isLikelyHttpURL(url) || url.startsWith("file://") || url.startsWith("mailto:")) {
    location.href = url;
    return;
  }

  if (replace) {
    history.replaceState(null, "", new URL(url, location.href));
  } else {
    history.pushState(null, "", new URL(url, location.href));
  }

  if (routerReady) {
    events.emit("popstate", { type: "popstate", resetScroll: true });
  } else if (!hasPreRedirect) {
    hasPreRedirect = true;
  }
}
