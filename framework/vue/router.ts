import type { Component, Ref, ShallowRef } from "vue";
import { createSSRApp, defineComponent, h, ref, shallowRef, watch } from "vue";
import { isPlainObject } from "../../shared/util.ts";
import type { RouteModule } from "../core/routes.ts";
import { loadRouterFromTag, loadSSRModulesFromTag, matchRoutes, prefetchRouteData } from "../core/routes.ts";
import events from "../core/events.ts";
import type { SSRContext } from "../../server/types.ts";
import { RouterContext } from "./context.ts";
import { Link } from "./link.ts";
import { Head } from "./head.ts";
import { Err } from "./error.ts";

export type RouteData = {
  data?: unknown;
  dataCacheTtl?: number;
  dataExpires?: number;
};

type RootProps = {
  ssrContext?: SSRContext;
};

type RouterProps = {
  modules: ShallowRef<RouteModule[]>;
  url: Ref<URL>;
  dataCache: Map<string, RouteData>;
  dataUrl: Ref<string>;
};

type RouterRootProps = {
  modules: ShallowRef<RouteModule[]>;
  dataCache: Map<string, RouteData>;
  ssrContext?: SSRContext;
};

const createRouter = ({ modules, url, dataCache, dataUrl }: RouterProps) => {
  const router = loadRouterFromTag();
  const _dataUrl = url.value.pathname + url.value.search;

  modules.value.forEach((module) => {
    const { data, dataCacheTtl } = module;
    dataCache.set(_dataUrl, {
      data,
      dataCacheTtl,
      dataExpires: Date.now() + (dataCacheTtl || 1) * 1000,
    });
  });

  watch(() => modules.value, () => {
    const params: Record<string, string> = {};
    modules.value.forEach((m) => Object.assign(params, m.params));
    dataUrl.value = url.value.pathname + url.value.search;
    RouterContext.value = { url: url.value, params };
  }, { immediate: true });

  const onmoduleprefetch = (e: Record<string, unknown>) => {
    const deployId = document.body.getAttribute("data-deployment-id");
    const pageUrl = new URL(e.href as string, location.href);
    const matches = matchRoutes(pageUrl, router);
    matches.map(([_, meta]) => {
      const { filename } = meta;
      try {
        __aleph.getRouteModule(filename);
      } catch (_e) {
        const link = document.createElement("link");
        let href = meta.filename.slice(1);
        if (deployId) {
          href += `?v=${deployId}`;
        }
        link.setAttribute("rel", "modulepreload");
        link.setAttribute("href", href);
        document.head.appendChild(link);
      }
    });
  };

  const onpopstate = async (e: Record<string, unknown>) => {
    const next_url = (e.url as URL | undefined) || new URL(window.location.href);
    const matches = matchRoutes(next_url, router);
    const next_modules = await Promise.all(matches.map(async ([ret, meta]) => {
      const { filename } = meta;
      const rmod: RouteModule = {
        url: new URL(ret.pathname.input + next_url.search, next_url.href),
        params: ret.pathname.groups,
        filename,
        exports: await __aleph.importRouteModule(filename),
      };
      const dataUrl = rmod.url.pathname + rmod.url.search;
      const dataConfig = rmod.exports.data as Record<string, unknown> | true | undefined;
      rmod.withData = Boolean(
        isPlainObject(dataConfig) ? dataConfig.fetch : dataConfig ?? rmod.exports.GET,
      );
      if (rmod.withData && !dataCache.has(dataUrl)) {
        await prefetchRouteData(dataCache, dataUrl);
      }
      return rmod;
    }));
    modules.value = next_modules;
    url.value = next_url;
    window.scrollTo(0, 0);
  };

  // deno-lint-ignore no-explicit-any
  const navigation = (window as any).navigation;
  // deno-lint-ignore no-explicit-any
  const onnavigate = (e: any) => {
    e.intercept({
      async handler() {
        await onpopstate({ type: "navigate", url: new URL(e.destination.url) });
      },
    });
  };

  if (navigation) {
    navigation.addEventListener("navigate", onnavigate);
  } else {
    globalThis.addEventListener("popstate", onpopstate as unknown as EventListener);
  }
  events.on("popstate", onpopstate);
  events.on("moduleprefetch", onmoduleprefetch);
  events.emit("router", { type: "router" });

  // todo: update routes by hmr
  const Router = defineComponent({
    name: "Router",
    beforeUnmount() {
      if (navigation) {
        navigation.removeEventListener("navigate", onnavigate);
      } else {
        globalThis.removeEventListener("popstate", onpopstate as unknown as EventListener);
      }
      events.off("popstate", onpopstate);
      events.off("moduleprefetch", onmoduleprefetch);
    },
    render() {
      if (modules.value.length > 0) {
        const defaultExport = modules.value[0].exports.default;
        if (modules.value.length > 1) {
          return h(
            defaultExport as Component,
            null,
            () => h(createRouterRoot({ modules: shallowRef(modules.value.slice(1)), dataCache })),
          );
        }
        return h(defaultExport as Component);
      }
      return h(Err, { status: 404, message: "page not found" });
    },
  });

  return Router;
};

const createRouterRoot = (props: RouterRootProps) => {
  const { modules, dataCache } = props;

  const RouterRoot = defineComponent({
    name: "RouterRoot",
    render() {
      if (modules.value.length > 0) {
        const defaultExport = modules.value[0].exports.default;
        if (modules.value.length > 1) {
          return h(
            defaultExport as Component,
            null,
            () => h(createRouterRoot({ modules: shallowRef(modules.value.slice(1)), dataCache })),
          );
        }
        if (defaultExport && typeof defaultExport === "object") {
          return h(defaultExport as Component);
        }
        return h(Err, { status: 400, message: "missing default export as a valid Vue component" });
      }
      throw new Error("modules must be non-empty array");
    },
  });

  return RouterRoot;
};

const createApp = (props?: RootProps) => {
  const { ssrContext } = props || {};
  const modules = shallowRef(ssrContext?.modules || loadSSRModulesFromTag());

  if (modules.value.length === 0) {
    return createSSRApp(Err, { status: 404, message: "page not found" });
  }

  const url = ref(ssrContext?.url || new URL(window.location?.href));
  const dataCache = new Map<string, RouteData>();
  const dataUrl = ref(url.value.pathname + url.value.search);

  const defaultRouteModules = modules.value[0];
  const { exports } = defaultRouteModules;

  if (exports.default) {
    const Router = createRouter({ modules, url, dataCache, dataUrl });
    const app = createSSRApp(defineComponent({
      name: "App",
      render() {
        return [h(Router)];
      },
    }));

    app.provide("modules", modules);
    app.provide("dataCache", dataCache);
    app.provide("ssrContext", ssrContext);
    app.provide("ssrHeadCollection", ssrContext?.headCollection);
    app.provide("dataUrl", dataUrl);

    // registe aleph/vue component
    app.component("Link", Link);
    app.component("Head", Head);

    return app;
  }

  return createSSRApp(Err);
};

const useRouter = () => {
  return RouterContext;
};

export { createApp, useRouter };
