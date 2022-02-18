import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import util from "../../lib/util.ts";
import MainContext from "./context.ts";

export type HttpMethod = "get" | "post" | "put" | "patch" | "delete";
export type HttpError = { method: HttpMethod; status: number; message: string };
export type UpdateStrategy<T> = "none" | "pending" | {
  optimisticUpdate: (data: T) => T;
  onFail?: (error: HttpError) => void;
};
export type DataState<T = any> = { data?: T; error?: HttpError; isLoading?: boolean; isMutating?: HttpMethod };

export const useData = <T = any>(path?: string): DataState<T> & { mutation: typeof mutation } => {
  const { dataCache, url: routeUrl } = useContext(MainContext);
  const dataUrl = useMemo(() => path || (routeUrl.pathname + routeUrl.search), [path, routeUrl]);
  const [dataStore, setDataStore] = useState<DataState>(() => {
    if (dataCache.has(dataUrl)) {
      const { data, expires } = dataCache.get(dataUrl)!;
      if (!expires || Date.now() < expires) {
        return { data };
      }
    }
    return {};
  });
  const action = useCallback(async (method: HttpMethod, fetcher: Promise<Response>, update: UpdateStrategy<T>) => {
    const optimistic = update && typeof update === "object" && update !== null &&
      typeof update.optimisticUpdate === "function";
    if (optimistic) {
      setDataStore(({ data }) => ({ data: update.optimisticUpdate(clone(data)), __data: data }));
    } else {
      setDataStore(({ data }) => ({ data, isMutating: method }));
    }

    const res = await fetcher;
    if (res.status >= 400) {
      const message = await res.text();
      const error: HttpError = { method, status: res.status, message };
      if (optimistic) {
        // @ts-ignore
        setDataStore(({ __data }) => ({ data: __data }));
        update.onFail?.(error);
      } else {
        setDataStore(({ data }) => ({ data, error }));
      }
      return res;
    }

    if (res.status >= 300) {
      const redirectUrl = res.headers.get("Location");
      if (redirectUrl) {
        location.href = redirectUrl;
      }
      return res;
    }

    if (update && res.ok) {
      try {
        const data = await res.json();
        setDataStore({ data });
      } catch (err) {
        const error: HttpError = { method, status: 0, message: "Invalid JSON data: " + err.message };
        if (optimistic) {
          // @ts-ignore
          setDataStore(({ __data }) => ({ data: __data }));
          update.onFail?.(error);
        } else {
          setDataStore(({ data }) => ({ data, error }));
        }
      }
      return res;
    }

    setDataStore(({ data }) => ({ data }));
    return res;
  }, []);
  const mutation = useMemo(() => {
    return {
      post: async (data?: unknown, update?: UpdateStrategy<T>) => {
        return action("post", jsonFetch("post", data, path), update ?? "pending");
      },
      put: async (data?: unknown, update?: UpdateStrategy<T>) => {
        return action("put", jsonFetch("put", data, path), update ?? "pending");
      },
      patch: async (data?: unknown, update?: UpdateStrategy<T>) => {
        return action("patch", jsonFetch("patch", data, path), update ?? "pending");
      },
      delete: async (params?: Record<string, string>, update?: UpdateStrategy<T>) => {
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
        return action("delete", fetch(url.toString(), { method: "delete" }), update ?? "pending");
      },
    };
  }, [path, routeUrl]);

  useEffect(() => {
    if (
      dataUrl &&
      (!dataCache.has(dataUrl) || (dataCache.get(dataUrl)!.expires || Date.now() + 1000) < Date.now())
    ) {
      setDataStore({ isLoading: true });
      fetch(dataUrl, { headers: { "X-Fetch-Data": "true" } })
        .then(async (res) => {
          if (res.ok) {
            const data = await res.json();
            const cc = res.headers.get("cache-control");
            const expires = cc && cc.includes("max-age") ? Date.now() + parseInt(cc.split("=")[1]) * 1000 : undefined;
            dataCache.set(dataUrl, { data, expires });
            setDataStore({ data });
          } else {
            const message = await res.text();
            setDataStore({ error: { method: "get", status: res.status, message } });
          }
        })
        .catch((err) => {
          setDataStore({
            error: {
              method: "get",
              status: 0,
              message: err.message,
            },
          });
        });
    }
  }, [dataCache, dataUrl]);

  return { ...dataStore, mutation };
};

function jsonFetch(method: string, data: unknown, href?: string) {
  return fetch(href || self.location?.href, {
    method,
    body: typeof data === "object" ? JSON.stringify(data) : "null",
    redirect: "manual",
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function clone<T>(obj: T): T {
  // @ts-ignore
  return typeof structuredClone === "function" ? structuredClone(obj) : JSON.parse(json.stringify(obj));
}
