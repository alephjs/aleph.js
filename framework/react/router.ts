import type { FC } from "https://esm.sh/react@17.0.2";
import { createElement, Fragment, useContext, useEffect, useMemo, useState } from "https://esm.sh/react@17.0.2";
import type { SSRContext } from "../../server/types.ts";
import events from "../core/events.ts";
import MainContext from "./context.ts";
import { E404Page } from "./error.ts";

export type RouterProps = {
  readonly layout?: FC<PegeProps>;
  readonly ssrContext?: SSRContext;
};

export type PegeProps = {
  url: URL;
};

export const Router: FC<RouterProps> = ({ layout = Fragment, ssrContext }) => {
  const [url, setUrl] = useState<URL & { _component?: FC<PegeProps> }>(() =>
    ssrContext?.url || new URL(globalThis.location?.href || "http://localhost/")
  );
  const dataCache = useMemo(() => {
    const cache = new Map();
    const [data, expires] = ssrContext ? [ssrContext.data, ssrContext.dataExpires] : loadSSRDataFromTag();
    cache.set(url.pathname + url.search, { data, expires });
    return cache;
  }, []);
  const Component = useMemo<FC<PegeProps>>(
    () =>
      ssrContext?.moduleDefaultExport as FC ||
      (window as { __ssrModuleDefaultExport?: FC }).__ssrModuleDefaultExport ||
      url._component ||
      E404Page,
    [url],
  );

  useEffect(() => {
    // remove ssr head elements
    const { head } = window.document;
    Array.from(head.children).forEach((el: Element) => {
      if (el.hasAttribute("ssr")) {
        head.removeChild(el);
      }
    });

    const onpopstate = (e: Record<string, unknown>) => {
      const url = new URL(location.href);
      // todo: cacha data
      // todo: load comonent
      setUrl(url);
      if (e.resetScroll) {
        window.scrollTo(0, 0);
      }
    };
    // deno-lint-ignore ban-ts-comment
    // @ts-ignore
    addEventListener("popstate", onpopstate);
    events.on("popstate", onpopstate);
    events.emit("routerready", { type: "routerready" });

    return () => {
      // deno-lint-ignore ban-ts-comment
      // @ts-ignore
      removeEventListener("popstate", onpopstate);
      events.off("popstate", onpopstate);
    };
  }, []);

  return createElement(
    MainContext.Provider,
    {
      value: {
        url,
        setUrl,
        dataCache,
        ssrHeadCollection: ssrContext?.headCollection,
      },
    },
    createElement(
      layout,
      null,
      createElement(Component),
    ),
  );
};

export const useRouter = (): { url: URL } => {
  const { url } = useContext(MainContext);
  return { url };
};

function loadSSRDataFromTag(): [unknown, number | undefined] {
  const ssrDataEl = self.document?.getElementById("aleph-ssr-data");
  if (ssrDataEl) {
    try {
      const ssrData = JSON.parse(ssrDataEl.innerText);
      const expires = ssrDataEl.getAttribute("data-expires");
      return [ssrData, parseInt(expires || "") || undefined];
    } catch (_e) {
      console.error("ssr-data: invalid JSON");
    }
  }
  return [undefined, undefined];
}
