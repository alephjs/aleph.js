import type { FC } from "https://esm.sh/react@17.0.2";
import { createElement, useContext, useEffect, useMemo, useState } from "https://esm.sh/react@17.0.2";
import type { SSRContext } from "../../types.d.ts";
import events from "../core/events.ts";
import MainContext from "./context.ts";
import { E404Page } from "./error.ts";

export type RouterProps = {
  readonly ssr?: SSRContext;
};

type PegeProps = {
  url: URL;
};

export const Router: FC<RouterProps> = ({ ssr }) => {
  const [url, setUrl] = useState<URL & { _component?: FC<PegeProps> }>(() =>
    ssr?.url || new URL(globalThis.location?.href || "http://localhost/")
  );
  const dataCache = useMemo(() => {
    const cache = new Map();
    const [data, expires] = ssr ? [ssr.data, ssr.dataExpires] : loadSSRDataFromTag();
    cache.set(url.pathname + url.search, { data, expires });
    return cache;
  }, []);
  const Component = useMemo<FC<PegeProps>>(
    () =>
      ssr?.moduleDefaultExport as FC ||
      (globalThis as Record<string, unknown>).__ssrModuleDefaultExport ||
      url._component ||
      E404Page,
    [url],
  );

  useEffect(() => {
    // remove ssr head elements
    const { head } = globalThis.document;
    Array.from(head.children).forEach((el: Element) => {
      if (el.hasAttribute("ssr")) {
        head.removeChild(el);
      }
    });
    events.on("popstate", (e) => {
      const url = new URL(location.href);
      // todo: cacha data
      // todo: load comonent
      setUrl(url);
      if (e.resetScroll) {
        window.scrollTo(0, 0);
      }
    });
  }, []);

  return createElement(
    MainContext.Provider,
    {
      value: {
        url,
        setUrl,
        dataCache,
        ssrHeadCollection: ssr?.headCollection,
      },
    },
    createElement(Component, { url }),
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
