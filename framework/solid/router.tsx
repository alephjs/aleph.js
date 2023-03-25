/** @jsxImportSource https://esm.sh/solid-js@1.6.12 */
import { createMemo, createSignal, Match, onCleanup, onMount, Show, Switch, useContext } from "solid-js";
import { Dynamic } from "solid-js/web";
import type { Accessor, Component } from "solid-js";
import type { SSRContext } from "../../server/types.ts";
import { redirect } from "../core/redirect.ts";
import { CSRContext, listenRouter, RouteModule } from "../core/router.ts";
import { RouterContext } from "./context.ts";
import { Err } from "./error.tsx";

type RouterProps = {
  csrContext?: CSRContext;
  ssrContext?: SSRContext;
};

export const Router: Component<RouterProps> = ({ csrContext, ssrContext }) => {
  const [url, setUrl] = createSignal(ssrContext?.url ?? new URL(window.location?.href));
  const [modules, setModules] = createSignal(csrContext?.modules ?? ssrContext?.modules ?? []);
  const [params, setParams] = createSignal({});
  const [e404, setE404] = createSignal(false);

  let dispose = () => {};
  onMount(() => {
    dispose = listenRouter(new Map(), (url, modules) => {
      const params: Record<string, string> = {};
      modules.forEach((m) => {
        Object.assign(params, m.params);
      });
      setUrl(url);
      setModules(modules);
      setParams(params);
      setE404(modules[modules.length - 1]?.url.pathname === "/_404");
    });
  });
  onCleanup(dispose);

  return (
    <RouterContext.Provider value={{ url, params, e404 }}>
      <Switch>
        <Match when={modules().length == 0}>
          <Err error={{ status: 404, message: "page not found" }} />
        </Match>
        <Match when={modules().length > 0}>
          <RouteRoot modules={modules} />
        </Match>
      </Switch>
    </RouterContext.Provider>
  );
};

type RouteRootProps = {
  modules: Accessor<RouteModule[]>;
};

const RouteRoot: Component<RouteRootProps> = ({ modules }: RouteRootProps) => {
  const comp = createMemo(() => modules()[0].exports.default);
  const next = createMemo(() => modules().slice(1));
  return (
    <Dynamic
      component={(comp() ?? Err) as Component<Record<string, unknown>>}
      error={!comp() ? { status: 500, message: "missing default export as a valid React component" } : undefined}
    >
      <Show when={next().length > 0}>
        <RouteRoot modules={next} />
      </Show>
    </Dynamic>
  );
};

export const useRouter = (): {
  url: Accessor<URL>;
  params: Accessor<Record<string, string>>;
  e404: Accessor<boolean>;
  redirect: typeof redirect;
} => {
  const { url, params, e404 } = useContext(RouterContext)!;
  return { url, params, e404, redirect };
};
