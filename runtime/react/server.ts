import { createElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { serve as alephServe, type ServerOptions } from "../../server/mod.ts";
import type { SSRContext, SSROptions } from "../../server/types.ts";
import util from "../../shared/util.ts";
import { App } from "./router.ts";

if (Deno.args.includes("--dev")) {
  // Enable react refresh
  Deno.env.set("REACT_REFRESH", "true");
}

/** The `bootstrapScript` to mark the suspense sync rendering is done. */
const bootstrapScript = `data:text/javascript;charset=utf-8;base64,${btoa("/* suspense mark */")}`;

export const render = (ctx: SSRContext): Promise<ReadableStream> => {
  if (ctx.routeModules.length === 0 || ctx.routeModules.at(-1)?.url.pathname === "/_404") {
    ctx.status = 404;
  }
  ctx.suspenseMark = {
    selector: "script",
    test: (el) => {
      if (el.getAttribute("src") === bootstrapScript) {
        el.remove();
        return true;
      }
      return false;
    },
  };
  return renderToReadableStream(
    createElement(App, { ssrContext: ctx }),
    {
      ...util.pick(ctx, "signal", "onError", "nonce"),
      bootstrapScripts: [bootstrapScript],
    },
  );
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
