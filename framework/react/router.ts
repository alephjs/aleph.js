import type { FC } from "https://esm.sh/react@17.0.2";
import { createElement, useContext, useEffect, useMemo, useState } from "https://esm.sh/react@17.0.2";
import type { SSREvent } from "../../types.d.ts";
import events from "../core/events.ts";
import MainContext from "./context.ts";

export type RouterProps = {
  readonly ssr?: SSREvent;
};

export const Router: FC<RouterProps> = ({ ssr }) => {
  const [url, setUrl] = useState<URL & { _component?: FC<any> }>(() =>
    ssr?.url || new URL(globalThis.location?.href || "http://localhost/")
  );
  const dataCache = useMemo<any>(() => {
    const cache = new Map();
    const [data, expires] = ssr ? [ssr.data, ssr.dataExpires] : loadSSRDataFromTag();
    cache.set(url.pathname + url.search, { data, expires });
    return cache;
  }, []);
  const Component = useMemo<FC<any>>(
    () => ssr?.moduleDefaultExport || (globalThis as any).__ssrComponent || url._component || E404,
    [url],
  );

  useEffect(() => {
    // remove ssr head elements
    const { head } = globalThis.document;
    Array.from(head.children).forEach((el: any) => {
      if (el.hasAttribute("ssr")) {
        head.removeChild(el);
      }
    });
    events.addListener("popstate", (e) => {
      const url = new URL(location.href);
      // todo: cacha data
      // todo: load comonent
      setUrl(url);
      if (e.resetScroll) {
        (window as any).scrollTo(0, 0);
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
        inlineStyles: new Map(),
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

const E404 = () => {
  return createElement(
    "div",
    {
      style: {
        width: "100vw",
        height: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
      },
    },
    createElement("strong", null, "404"),
    createElement("em", { style: { color: "#999" } }, "-"),
    "page not found",
  );
};

function loadSSRDataFromTag(): [any, number | undefined] {
  const ssrDataEl = self.document?.getElementById("aleph-ssr-data");
  if (ssrDataEl) {
    try {
      const ssrData = JSON.parse(ssrDataEl.innerText);
      const expires = ssrDataEl.getAttribute("data-expires");
      return [ssrData, parseInt(expires || "") || undefined];
    } catch (e) {
      console.error("ssr-data: invalid JSON");
    }
  }
  return [undefined, undefined];
}
