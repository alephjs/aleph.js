import { createElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import type { Plugin, SSRContext, SSROptions } from "../../server/types.ts";
import { isPlainObject, pick } from "../../shared/util.ts";
import { App } from "./router.ts";

/** The `suspenseMarker` to mark the susponse rendering is starting. */
const suspenseMarker = `data:text/javascript;/** suspense marker **/`;

export const render = (ctx: SSRContext): Promise<ReadableStream> => {
  if (ctx.modules.length === 0 || ctx.modules.at(-1)?.url.pathname === "/_404") {
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

export type PluginOptions = {
  ssr?: boolean | SSROptions;
};

export default function ReactPlugin(options?: PluginOptions): Plugin {
  return {
    name: "react",
    setup(aleph) {
      if (Deno.args.includes("--dev")) {
        // Enable react refresh
        Deno.env.set("REACT_REFRESH", "true");
      }
      if (options?.ssr) {
        aleph.ssr = {
          ...(isPlainObject(options.ssr) ? options.ssr : {}),
          render,
        };
      }
    },
  };
}
