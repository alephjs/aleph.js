import { renderToWebStream } from "@vue/server-renderer";
import { builtinModuleExts } from "../../server/helpers.ts";
import { serve as alephServe, type ServeOptions } from "../../server/mod.ts";
import type { SSRContext, SSROptions } from "../../server/types.ts";
import { pick } from "../../shared/util.ts";
import { createApp } from "./router.ts";
import SFCLoader from "./sfc-loader.ts";

export const render = (ctx: SSRContext): ReadableStream => {
  if (ctx.modules.length === 0 || ctx.modules.at(-1)?.url.pathname === "/_404") {
    ctx.setStatus(404);
  }
  return renderToWebStream(createApp({ ssrContext: ctx }), pick(ctx, "signal", "nonce"));
};

export function serve(options?: Omit<ServeOptions, "ssr"> & { ssr?: boolean | SSROptions }) {
  return alephServe({
    ...options,
    loaders: [...(options?.loaders ?? []), new SFCLoader()],
    router: {
      exts: ["vue", ...builtinModuleExts],
      ...options?.router,
    },
    ssr: options?.ssr
      ? {
        ...(typeof options.ssr === "object" ? options.ssr : {}),
        render,
      }
      : undefined,
  });
}
