import { createElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { serve as alephServe, type ServerOptions } from "../../server/mod.ts";
import type { SSRContext, SSROptions } from "../../server/types.ts";
import { App } from "./router.ts";

if (Deno.args.includes("--dev")) {
  // Enable react refresh
  Deno.env.set("REACT_REFRESH", "true");
}

export const render = (ctx: SSRContext): [Promise<ReadableStream>, number] => {
  let status = 200;
  if (ctx.routeModules.length === 0 || ctx.routeModules.at(-1)?.url.pathname === "/_404") {
    status = 404;
  }
  return [renderToReadableStream(createElement(App, { ssrContext: ctx }), ctx), status];
};

export function serve(
  options?: Omit<ServerOptions, "ssr"> & { ssr?: boolean | SSROptions },
) {
  alephServe({
    ...options,
    ssr: options?.ssr
      ? {
        ...(typeof options.ssr === "object" ? options.ssr : {}),
        render,
      }
      : undefined,
  });
}
