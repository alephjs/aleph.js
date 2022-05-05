import type { FC, PropsWithChildren } from "react";
import { createElement, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import FetchError from "../core/fetch_error.ts";
import type { DataContextProps, HttpMethod, UpdateStrategy } from "./context.ts";
import { DataContext } from "./context.ts";

export type RouteData = {
  data?: unknown;
  dataCacheTtl?: number;
  dataExpires?: number;
};

export type DataProviderProps = PropsWithChildren<{
  dataUrl: string;
  dataCache: Map<string, RouteData>;
}>;

export const DataProvider: FC<DataProviderProps> = ({ dataUrl, dataCache, children }) => {
  const suspenseData = useRef<unknown>();
  const [data, setData] = useState(() => {
    const cached = dataCache.get(dataUrl);
    if (cached) {
      if (typeof cached.data === "function") {
        const data = cached.data();
        if (data instanceof Promise) {
          return data.then((data) => {
            suspenseData.current = data;
          }).catch((error) => {
            suspenseData.current = error;
          });
        }
        throw new Error(`Data for ${dataUrl} has invalid type [function].`);
      }
      return cached.data;
    }
    throw new Error(`Data for ${dataUrl} is not found`);
  });
  const [isMutating, setIsMutating] = useState<HttpMethod | boolean>(false);
  const action = useCallback(async (method: HttpMethod, fetcher: Promise<Response>, update: UpdateStrategy) => {
    const updateIsObject = update && typeof update === "object" && update !== null;
    const optimistic = updateIsObject && typeof update.optimisticUpdate === "function";
    const replace = update === "replace" || (updateIsObject && !!update.replace);

    let rollbackData: unknown = undefined;
    if (optimistic) {
      const optimisticUpdate = update.optimisticUpdate!;
      setData((prev: unknown) => {
        if (prev !== undefined) {
          rollbackData = prev;
          return optimisticUpdate(shallowClone(prev));
        }
        return prev;
      });
    }

    setIsMutating(method);
    const res = await fetcher;
    if (res.status >= 400) {
      if (optimistic) {
        if (rollbackData !== undefined) {
          setData(rollbackData);
        }
        if (update.onFailure) {
          update.onFailure(await FetchError.fromResponse(res));
        }
      }
      setIsMutating(false);
      return res;
    }

    if (res.status >= 300) {
      const redirectUrl = res.headers.get("Location");
      if (redirectUrl) {
        location.href = new URL(redirectUrl, location.href).href;
      }
      if (optimistic && rollbackData !== undefined) {
        setData(rollbackData);
      }
      setIsMutating(false);
      return res;
    }

    if (replace && res.ok) {
      try {
        const data = await res.json();
        const dataCacheTtl = dataCache.get(dataUrl)?.dataCacheTtl;
        dataCache.set(dataUrl, { data, dataCacheTtl, dataExpires: Date.now() + (dataCacheTtl || 1) * 1000 });
        setData(data);
      } catch (_) {
        if (optimistic) {
          if (rollbackData !== undefined) {
            setData(rollbackData);
          }
          if (update.onFailure) {
            update.onFailure(new FetchError(500, {}, "Data must be valid JSON"));
          }
        }
      }
    }

    setIsMutating(false);
    return res;
  }, [dataUrl]);
  const reload = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch(dataUrl, { headers: { "Accept": "application/json" }, signal, redirect: "manual" });
      if (res.type === "opaqueredirect") {
        throw new Error("opaque redirect");
      }
      if (!res.ok) {
        throw await FetchError.fromResponse(res);
      }
      try {
        const data = await res.json();
        const cc = res.headers.get("Cache-Control");
        const dataCacheTtl = cc && cc.includes("max-age=") ? parseInt(cc.split("max-age=")[1]) : undefined;
        const dataExpires = Date.now() + (dataCacheTtl || 1) * 1000;
        dataCache.set(dataUrl, { data, dataExpires });
        setData(data);
      } catch (_e) {
        throw new FetchError(500, {}, "Data must be valid JSON");
      }
    } catch (error) {
      throw new Error(`Failed to reload data for ${dataUrl}: ${error.message}`);
    }
  }, [dataUrl]);
  const mutation = useMemo(() => {
    return {
      post: (data?: unknown, update?: UpdateStrategy) => {
        return action("post", send("post", dataUrl, data), update ?? "none");
      },
      put: (data?: unknown, update?: UpdateStrategy) => {
        return action("put", send("put", dataUrl, data), update ?? "none");
      },
      patch: (data?: unknown, update?: UpdateStrategy) => {
        return action("patch", send("patch", dataUrl, data), update ?? "none");
      },
      delete: (data?: unknown, update?: UpdateStrategy) => {
        return action("delete", send("delete", dataUrl, data), update ?? "none");
      },
    };
  }, [dataUrl]);

  useEffect(() => {
    const now = Date.now();
    const cache = dataCache.get(dataUrl);
    let ac: AbortController | null = null;
    if (
      cache === undefined ||
      (cache.data !== undefined && (cache.dataExpires === undefined || cache.dataExpires < now))
    ) {
      ac = new AbortController();
      reload(ac.signal).finally(() => {
        ac = null;
      });
    } else if (cache.data !== undefined) {
      setData(cache.data);
    }

    return () => ac?.abort();
  }, [dataUrl]);

  return createElement(
    DataContext.Provider,
    { value: { suspenseData, data, isMutating, mutation, reload } },
    children,
  );
};

export const useData = <T = unknown>(): Omit<DataContextProps<T>, "suspenseData"> => {
  const { suspenseData, data, ...rest } = useContext(DataContext) as DataContextProps<T>;
  if (data instanceof Promise) {
    if (suspenseData?.current instanceof Error) {
      throw suspenseData.current;
    }
    if (suspenseData?.current !== undefined) {
      return { ...rest, data: suspenseData.current };
    }
    throw data;
  }
  return { data, ...rest };
};

function send(method: HttpMethod, href: string, data: unknown) {
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
    } else if (data instanceof URLSearchParams) {
      body = data;
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

function shallowClone<T>(obj: T): T {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }
  if (Array.isArray(obj)) {
    return [...obj] as unknown as T;
  }
  return { ...obj };
}
