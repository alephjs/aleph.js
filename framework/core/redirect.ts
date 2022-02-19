import util from "../../lib/util.ts";
import events from "./events.ts";

const routerState = {
  ready: false,
  hasPreRedirect: false,
};

const onrouterready = (_: Record<string, unknown>) => {
  events.off("routerready", onrouterready);
  if (routerState.hasPreRedirect) {
    events.emit("popstate", { type: "popstate", resetScroll: true });
  }
  routerState.ready = true;
};
events.on("routerready", onrouterready);

export function redirect(url: string, replace?: boolean) {
  const { location, history } = window;

  if (!util.isFilledString(url)) {
    return;
  }

  if (
    util.isLikelyHttpURL(url) || url.startsWith("file://") ||
    url.startsWith("mailto:")
  ) {
    location.href = url;
    return;
  }

  url = util.cleanPath(url);
  if (replace) {
    history.replaceState(null, "", url);
  } else {
    history.pushState(null, "", url);
  }

  if (routerState.ready) {
    events.emit("popstate", { type: "popstate", resetScroll: true });
  } else if (!routerState.hasPreRedirect) {
    routerState.hasPreRedirect = true;
  }
}
