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

/** The `suspenseMark` to mark the susponse rendering is starting. */
const suspenseMark = `data:text/javascript;/** suspense mark **/`;

export const render = (ctx: SSRContext): Promise<ReadableStream> => {
  if (ctx.routeModules.length === 0 || ctx.routeModules.at(-1)?.url.pathname === "/_404") {
    ctx.status = 404;
  }
  ctx.suspenseMark = {
    selector: "script",
    test: (el) => {
      if (el.getAttribute("src") === suspenseMark) {
        el.remove();
        return true;
      }
      return false;
    },
  };
  return renderToReadableStream(
    createElement(App, { ssrContext: ctx }),
    {
      ...util.pick(ctx, "signal", "nonce"),
      bootstrapScripts: [suspenseMark],
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
