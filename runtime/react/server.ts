import { createElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { serve as alephServe, type ServerOptions } from "../../server/mod.ts";
import type { SSRContext, SSROptions } from "../../server/types.ts";
import { pick } from "../../shared/util.ts";
import { App } from "./router.ts";

if (Deno.args.includes("--dev")) {
  // Enable react refresh
  Deno.env.set("SWC_REACT_REFRESH", "true");
}

/** The `suspenseMarker` to mark the susponse rendering is starting. */
const suspenseMarker = `data:text/javascript;/** suspense marker **/`;

export const render = (ctx: SSRContext): Promise<ReadableStream> => {
  if (ctx.routing.length === 0 || ctx.routing.at(-1)?.url.pathname === "/_404") {
    ctx.setStatus(404);
  }
  // support suspense rendering in server-side
  ctx.setSuspenseMarker("script", (el) => {
    if (el.getAttribute("src") === suspenseMarker) {
      el.remove();
      return true;
    }
    return false;
  });
  return renderToReadableStream(
    createElement(App, { ssrContext: ctx }),
    {
      ...pick(ctx, "signal", "nonce"),
      bootstrapScripts: [suspenseMarker],
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
