import type { FC } from "https://esm.sh/react@17.0.2";
import { createElement, useContext, useEffect, useMemo, useState } from "https://esm.sh/react@17.0.2";
import type { SSRContext } from "../../server/types.ts";
import events from "../core/events.ts";
import MainContext from "./context.ts";
import { E404Page } from "./error.ts";

export type RouterProps = {
  readonly ssrContext?: SSRContext;
};

export const Router: FC<RouterProps> = ({ ssrContext }) => {
  const [url, setUrl] = useState<URL & { _component?: FC }>(() =>
    ssrContext?.url || new URL(globalThis.location?.href || "http://localhost/")
  );
  const dataCache = useMemo(() => {
    const cache = new Map();
    const data = ssrContext
      ? ssrContext.imports.map(({ url, data, dataCacheTtl }) => ({
        url: url.pathname + url.search,
        data,
        dataCacheTtl,
      }))
      : loadSSRDataFromTag();
    data?.forEach(({ url, data, dataCacheTtl }) => {
      cache.set(url, { data, dataCacheTtl });
    });
    return cache;
  }, []);
  const [app, _setApp] = useState(() => {
    if (ssrContext) {
      return {
        Component: ssrContext?.imports.find(({ url }) => url.pathname === "/_app")?.defaultExport as FC | undefined,
      };
    }
    return {
      Component: ((window as { __ssrModules?: Record<string, { default?: FC }> }).__ssrModules || {})["/_app"]?.default,
    };
  });
  const routeComponent = useMemo<FC>(
    () => {
      const href = url.pathname + url.search;
      return ssrContext?.imports.find((i) => i.url.pathname + i.url.search === href)?.defaultExport as FC ||
        ((window as { __ssrModules?: Record<string, Record<string, FC>> }).__ssrModules || {})[href]?.default ||
        url._component ||
        E404Page;
    },
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

  const routeEl = createElement(
    MainContext.Provider,
    {
      value: {
        url,
        setUrl,
        dataCache,
        ssrHeadCollection: ssrContext?.headCollection,
      },
    },
    createElement(routeComponent),
  );

  if (app.Component) {
    return createElement(
      MainContext.Provider,
      {
        value: {
          url: new URL("/_app", url.href),
          setUrl: () => {},
          dataCache,
          ssrHeadCollection: ssrContext?.headCollection,
        },
      },
      createElement(app.Component, null, routeEl),
    );
  }

  return routeEl;
};

export const useRouter = (): { url: URL } => {
  const { url } = useContext(MainContext);
  return { url };
};

function loadSSRDataFromTag(): { url: string; data?: unknown; dataCacheTtl?: number }[] | undefined {
  const ssrDataEl = self.document?.getElementById("aleph-ssr-data");
  if (ssrDataEl) {
    try {
      const ssrData = JSON.parse(ssrDataEl.innerText);
      return ssrData;
    } catch (_e) {
      console.error("ssr-data: invalid JSON");
    }
  }
  return undefined;
}
