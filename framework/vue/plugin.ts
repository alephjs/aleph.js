import { renderToWebStream } from "@vue/server-renderer";
import type { Plugin, SSRContext, SSROptions } from "../../server/types.ts";
import { isPlainObject, pick } from "../../shared/util.ts";
import { createApp } from "./router.ts";
import SFCLoader from "./sfc-loader.ts";

export const render = (ctx: SSRContext): ReadableStream => {
  if (ctx.modules.length === 0 || ctx.modules.at(-1)?.url.pathname === "/_404") {
    ctx.setStatus(404);
  }
  return renderToWebStream(createApp({ ssrContext: ctx }), pick(ctx, "signal", "nonce"));
};

export default function VuePlugin(options?: { ssr?: boolean | SSROptions }): Plugin {
  return {
    name: "vue",
    setup(aleph) {
      Object.assign(aleph, {
        loaders: [new SFCLoader(), ...(aleph.loaders ?? [])],
        router: {
          exts: ["vue"],
        },
        ssr: options?.ssr
          ? {
            ...(isPlainObject(options.ssr) ? options.ssr : {}),
            render,
          }
          : undefined,
      });
    },
  };
}
