import { inject, onBeforeUnmount, Ref, ref, toRaw, watch } from "vue";
import FetchError from "../core/fetch_error.ts";
import type { SSRContext } from "../../server/renderer.ts";
import { HttpMethod, UpdateStrategy } from "./context.ts";

export type RouteData = {
  data?: unknown;
  dataCacheTtl?: number;
  dataExpires?: number;
};

export type DataProviderProps = {
  dataUrl: string;
  dataCache: Map<string, RouteData>;
};

const createDataProvider = () => {
  const dataCache: Map<string, RouteData> = inject("dataCache") || new Map();
  const ssrContext: SSRContext | undefined = inject("ssrContext");
  const url = ssrContext?.url || new URL(window.location?.href);
  const defaultDataUrl = url.pathname + url.search;
  const dataUrl: Ref<string> = inject("dataUrl") || ref(defaultDataUrl);

  const cached = dataCache?.get(dataUrl.value);

  if (cached) {
    if (cached.data instanceof Error) {
      throw cached.data;
    }
    if (typeof cached.data === "function") {
      const data = cached.data();
      if (data instanceof Promise) {
        data.then((data) => {
          cached.data = data;
        }).catch((error) => {
          cached.data = error;
        });
      }
      throw new Error(`Data for ${dataUrl} has invalid type [function].`);
    }
  } else {
    throw new Error(`Data for ${dataUrl} is not found`);
  }

  const _data: Ref<unknown> = ref(cached?.data);
  const isMutating = ref<HttpMethod | boolean>(false);

  const action = async (method: HttpMethod, fetcher: Promise<Response>, update: UpdateStrategy) => {
    const updateIsObject = update && typeof update === "object" && update !== null;
    const optimistic = updateIsObject && typeof update.optimisticUpdate === "function";
    const replace = update === "replace" || (updateIsObject && !!update.replace);

    let rollbackData: unknown = undefined;
    if (optimistic) {
      const optimisticUpdate = update.optimisticUpdate!;
      if (_data.value !== undefined) {
        rollbackData = toRaw(_data.value);
        _data.value = optimisticUpdate(shallowClone(toRaw(_data.value)));
      }
    }

    isMutating.value = method;
    const res = await fetcher;
    if (res.status >= 400) {
      if (optimistic) {
        if (rollbackData !== undefined) {
          _data.value = rollbackData;
        }
        if (update.onFailure) {
          update.onFailure(await FetchError.fromResponse(res));
        }
      }
      isMutating.value = false;
      return res;
    }

    if (res.status >= 300) {
      const redirectUrl = res.headers.get("Location");
      if (redirectUrl) {
        location.href = new URL(redirectUrl, location.href).href;
      }
      if (optimistic && rollbackData !== undefined) {
        _data.value = rollbackData;
      }
      isMutating.value = false;
      return res;
    }

    if (replace && res.ok) {
      try {
        const data = await res.json();
        const dataCacheTtl = dataCache.get(dataUrl.value)?.dataCacheTtl;
        dataCache.set(dataUrl.value, { data, dataCacheTtl, dataExpires: Date.now() + (dataCacheTtl || 1) * 1000 });
        _data.value = data;
      } catch (_) {
        if (optimistic) {
          if (rollbackData !== undefined) {
            _data.value = rollbackData;
          }
          if (update.onFailure) {
            update.onFailure(new FetchError(500, {}, "Data must be valid JSON"));
          }
        }
      }
    }

    isMutating.value = false;
    return res;
  };

  const reload = async (signal?: AbortSignal) => {
    try {
      const res = await fetch(dataUrl.value, { headers: { "Accept": "application/json" }, signal, redirect: "manual" });
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
        dataCache.set(dataUrl.value, { data, dataExpires });
        _data.value = data;
      } catch (_e) {
        throw new FetchError(500, {}, "Data must be valid JSON");
      }
    } catch (error) {
      throw new Error(`Failed to reload data for ${dataUrl.value}: ${error.message}`);
    }
  };

  const mutation = {
    post: (data?: unknown, update?: UpdateStrategy) => {
      return action("post", send("post", dataUrl.value, data), update ?? "none");
    },
    put: (data?: unknown, update?: UpdateStrategy) => {
      return action("put", send("put", dataUrl.value, data), update ?? "none");
    },
    patch: (data?: unknown, update?: UpdateStrategy) => {
      return action("patch", send("patch", dataUrl.value, data), update ?? "none");
    },
    delete: (data?: unknown, update?: UpdateStrategy) => {
      return action("delete", send("delete", dataUrl.value, data), update ?? "none");
    },
  };

  watch(() => dataUrl.value, () => {
    const now = Date.now();
    const cache = dataCache.get(dataUrl.value);
    let ac: AbortController | null = null;
    if (cache === undefined || cache.dataExpires === undefined || cache.dataExpires < now) {
      ac = new AbortController();
      reload(ac.signal).finally(() => {
        ac = null;
      });
    } else if (cache.data !== undefined) {
      _data.value = cache.data as never;
    }

    onBeforeUnmount(() => ac?.abort());
  });

  return { data: _data, isMutating, mutation, reload };
};

export const useData = () => {
  return createDataProvider();
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
