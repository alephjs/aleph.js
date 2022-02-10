import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import util from "../../lib/util.ts";
import MainContext from "./context.ts";

export type HttpMethod = "get" | "post" | "put" | "patch" | "delete";

export type DataState<T = any> = {
  data?: T;
  error?: { method: HttpMethod; status: number; message: string };
  isLoading?: boolean;
  isMutating?: HttpMethod;
};

const jsonFetch = (method: string, data: unknown, href?: string) => {
  return fetch(href || self.location?.href, {
    method,
    body: typeof data === "object" ? JSON.stringify(data) : undefined,
    headers: {
      "content-type": "application/json",
    },
  });
};

export const useData = <T = any>(
  path?: string,
): DataState<T> & { mutation: typeof mutation } => {
  const { dataCache, url: routeUrl } = useContext(MainContext);
  const [dataStore, setDataStore] = useState<DataState>(() => {
    const pagePath = path || (routeUrl.pathname + routeUrl.search);
    if (dataCache.has(pagePath)) {
      const { data, expires } = dataCache.get(pagePath)!;
      if (!expires || Date.now() < expires) {
        return { data };
      }
    }
    return {};
  });
  const action = useCallback(
    async (
      method: HttpMethod,
      fetcher: Promise<Response>,
      replace?: boolean,
    ) => {
      setDataStore(({ data }) => ({ data, isMutating: method }));
      const res = await fetcher;
      const { status } = res;
      if (status >= 400) {
        const message = await res.text();
        setDataStore(({ data }) => ({
          data,
          error: { method, status, message },
        }));
        return res;
      }
      if (replace && status === 200) {
        try {
          const data = await res.json();
          setDataStore({ data });
        } catch (err) {
          setDataStore({
            error: {
              status: 0,
              message: "Invalid JSON data: " + err.message,
              method,
            },
          });
        }
      } else {
        setDataStore(({ data }) => ({ data }));
      }
      return res;
    },
    [],
  );
  const mutation = useMemo(() => {
    return {
      post: async (data?: unknown, replace?: boolean) => {
        return action("post", jsonFetch("post", data, path), replace);
      },
      put: async (data?: unknown, replace?: boolean) => {
        return action("put", jsonFetch("put", data, path), replace);
      },
      patch: async (data?: unknown, replace?: boolean) => {
        return action("patch", jsonFetch("patch", data, path), replace);
      },
      delete: async (params?: Record<string, string>, replace?: boolean) => {
        let url = routeUrl;
        if (path) {
          url = new URL(self.location?.href);
          const [pathname, search] = util.splitBy(path, "?");
          url.pathname = util.cleanPath(pathname);
          url.search = search;
        }
        if (params) {
          for (const [key, value] of Object.entries(params)) {
            url.searchParams.set(key, value);
          }
        }
        return action(
          "delete",
          fetch(url.toString(), { method: "delete" }),
          replace,
        );
      },
    };
  }, [path, routeUrl]);

  useEffect(() => {
    if (path && !dataCache.has(path)) {
      fetch(path, { headers: { "X-Fetch-Data": "true" } }).then(async (res) => {
        if (res.ok) {
          const data = await res.json();
          const cc = res.headers.get("cache-control");
          const expires = cc && cc.includes("max-age") ? Date.now() + parseInt(cc.split("=")[1]) * 1000 : undefined;
          dataCache.set(path, { data, expires });
          setDataStore({ data });
        }
      });
    }
  }, [dataCache, path]);

  return { ...dataStore, mutation };
};
