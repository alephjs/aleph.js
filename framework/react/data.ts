import { useCallback, useContext, useEffect, useMemo, useState } from "react";
import { DataContext } from "./context.ts";

export type HttpMethod = "get" | "post" | "put" | "patch" | "delete";
export type FetchError = { method: HttpMethod; status: number; message: string };
export type DataState<T> = { data?: T; error?: FetchError; isLoading?: boolean; isMutating?: HttpMethod };
export type UpdateStrategy<T> = "none" | "replace" | {
  optimisticUpdate?: (data: T) => T;
  onFailure?: (error: FetchError) => void;
  replace?: boolean;
};

export const useData = <T = unknown>(path?: string): DataState<T> & { mutation: typeof mutation } => {
  const { dataUrl: dataUrlCtx, dataCache } = useContext(DataContext);
  const dataUrl = useMemo(() => path || dataUrlCtx, [path, dataUrlCtx]);
  const [dataStore, setDataStore] = useState<DataState<T>>(() => {
    if (dataCache.has(dataUrl)) {
      const { data } = dataCache.get(dataUrl)!;
      return { data: data as T };
    }
    return {};
  });
  const action = useCallback(async (method: HttpMethod, fetcher: Promise<Response>, update: UpdateStrategy<T>) => {
    const updateIsObject = update && typeof update === "object" && update !== null;
    const optimistic = updateIsObject && typeof update.optimisticUpdate === "function";
    const replace = update === "replace" || (updateIsObject && !!update.replace);

    let rollbackData: T | undefined = undefined;
    if (optimistic) {
      const optimisticUpdate = update.optimisticUpdate!;
      setDataStore((store) => {
        if (store.data !== undefined) {
          rollbackData = store.data;
          return { data: optimisticUpdate(clone(store.data)) };
        }
        return store;
      });
    } else {
      setDataStore(({ data }) => ({ data, isMutating: method }));
    }

    const res = await fetcher;
    if (res.status >= 400) {
      const message = await res.text();
      const error: FetchError = { method, status: res.status, message };
      if (optimistic) {
        setDataStore({ data: rollbackData });
        update.onFailure?.(error);
      } else {
        setDataStore(({ data }) => ({ data, error }));
      }
      return res;
    }

    if (res.status >= 300) {
      const redirectUrl = res.headers.get("Location");
      if (redirectUrl) {
        location.href = redirectUrl;
      } else {
        if (optimistic) {
          setDataStore({ data: rollbackData });
        } else {
          setDataStore(({ data }) => ({ data }));
        }
        return res;
      }
    }

    if (replace && res.ok) {
      try {
        const data = await res.json();
        setDataStore({ data });
        const dataCacheTtl = dataCache.get(dataUrl)?.dataCacheTtl;
        dataCache.set(dataUrl, { data, dataCacheTtl, dataExpires: Date.now() + (dataCacheTtl || 1) * 1000 });
      } catch (err) {
        const error: FetchError = { method, status: 0, message: "Invalid JSON data: " + err.message };
        if (optimistic) {
          setDataStore({ data: rollbackData });
          update.onFailure?.(error);
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
      post: (data?: unknown, update?: UpdateStrategy<T>) => {
        return action("post", send("POST", dataUrl, data), update ?? "none");
      },
      put: (data?: unknown, update?: UpdateStrategy<T>) => {
        return action("put", send("PUT", dataUrl, data), update ?? "none");
      },
      patch: (data?: unknown, update?: UpdateStrategy<T>) => {
        return action("patch", send("PATCH", dataUrl, data), update ?? "none");
      },
      delete: (data?: unknown, update?: UpdateStrategy<T>) => {
        return action("patch", send("DELETE", dataUrl, data), update ?? "none");
      },
    };
  }, [dataUrl]);

  useEffect(() => {
    const now = Date.now();
    const cache = dataCache.get(dataUrl);
    let ac: AbortController | null = null;
    if (!cache || cache.dataExpires === undefined || cache.dataExpires < now) {
      if (!cache) {
        setDataStore({ isLoading: true });
      }
      ac = new AbortController();
      fetch(dataUrl, { headers: { "X-Fetch-Data": "true" }, signal: ac.signal, redirect: "manual" })
        .then(async (res) => {
          if (res.status >= 400) {
            const message = await res.text();
            const error: FetchError = { method: "get", status: res.status, message };
            setDataStore(({ data }) => ({ data, error }));
            return;
          }
          if (res.status >= 300) {
            const redirectUrl = res.headers.get("Location");
            if (redirectUrl) {
              location.href = redirectUrl;
            }
            setDataStore(({ data }) => ({ data }));
            return;
          }
          if (res.ok) {
            const data = await res.json();
            const cc = res.headers.get("Cache-Control");
            const dataCacheTtl = cc && cc.includes("max-age=") ? parseInt(cc.split("max-age=")[1]) : undefined;
            const dataExpires = Date.now() + (dataCacheTtl || 1) * 1000;
            setDataStore({ data });
            dataCache.set(dataUrl, { data, dataExpires });
          } else {
            const message = await res.text();
            setDataStore({ error: { method: "get", status: res.status, message } });
          }
        })
        .catch((err) => {
          setDataStore({ error: { method: "get", status: 0, message: err.message } });
        }).finally(() => {
          ac = null;
        });
    }

    return () => {
      ac?.abort();
    };
  }, [dataUrl]);

  return { ...dataStore, mutation };
};

function send(method: string, href: string, data: unknown) {
  let body: BodyInit | undefined;
  const headers = new Headers();
  if (typeof data === "string") {
    body = data;
  } else if (typeof data === "number") {
    body = data.toString();
  } else if (typeof data === "object") {
    if (data instanceof ArrayBuffer || data instanceof Uint8Array) {
      body = data;
    } else if (data instanceof FormData) {
      body = data;
      headers.append("Content-Type", "multipart/form-data");
    } else if (data instanceof URLSearchParams) {
      body = data;
      headers.append("Content-Type", "application/x-www-form-urlencoded");
    } else if (data instanceof Blob) {
      body = data;
      headers.append("Content-Type", data.type);
    } else {
      body = JSON.stringify(data);
      headers.append("Content-Type", "application/json; charset=utf-8");
    }
  }
  return fetch(href, { method, body, headers, redirect: "manual" });
}

function clone<T>(obj: T): T {
  // deno-lint-ignore ban-ts-comment
  // @ts-ignore
  return typeof structuredClone === "function" ? structuredClone(obj) : JSON.parse(JSON.stringify(obj));
}
