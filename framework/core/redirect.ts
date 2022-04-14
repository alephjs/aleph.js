import util from "../../lib/util.ts";
import events from "./events.ts";

let routerReady = false;
let preRedirect: { url: URL; replace?: boolean } | null = null;

const onrouterready = (_: Record<string, unknown>) => {
  events.off("routerready", onrouterready);
  if (preRedirect) {
    events.emit("popstate", { type: "popstate", ...preRedirect });
    preRedirect = null;
  }
  routerReady = true;
};
events.on("routerready", onrouterready);

export function redirect(url: string, replace?: boolean) {
  const { location } = window;

  if (!util.isFilledString(url)) {
    return;
  }

  if (util.isLikelyHttpURL(url) || url.startsWith("file://") || url.startsWith("mailto:")) {
    location.href = url;
    return;
  }

  const redirectOptions = { url: new URL(url, location.href), replace };
  if (routerReady) {
    events.emit("popstate", { type: "popstate", ...redirectOptions });
  } else {
    preRedirect = redirectOptions;
  }
}
